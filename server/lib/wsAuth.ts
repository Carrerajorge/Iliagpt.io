import { IncomingMessage } from "http";
import { WebSocket, WebSocketServer } from "ws";
import session from "express-session";
import connectPg from "connect-pg-simple";
import cookie from "cookie";
import cookieSignature from "cookie-signature";

const sessionTtl = 7 * 24 * 60 * 60 * 1000;

let sessionStore: session.Store | null = null;

function getSessionStore(): session.Store {
  if (!sessionStore) {
    const PgStore = connectPg(session);
    sessionStore = new PgStore({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: false,
      ttl: sessionTtl,
      tableName: "sessions",
    });
  }
  return sessionStore;
}

export interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  userEmail?: string;
  isAuthenticated: boolean;
}

export interface WsAuthResult {
  isAuthenticated: boolean;
  userId?: string;
  userEmail?: string;
  error?: string;
}

export async function authenticateWebSocket(
  request: IncomingMessage
): Promise<WsAuthResult> {
  try {
    const cookies = cookie.parse(request.headers.cookie || "");
    const sessionCookie = cookies["connect.sid"];

    if (!sessionCookie) {
      return { isAuthenticated: false, error: "No session cookie" };
    }

    const sessionId = extractSessionId(sessionCookie);
    if (!sessionId) {
      return { isAuthenticated: false, error: "Invalid session cookie format" };
    }

    const store = getSessionStore();
    
    return new Promise((resolve) => {
      store.get(sessionId, (err, sessionData) => {
        if (err) {
          resolve({ isAuthenticated: false, error: "Session lookup failed" });
          return;
        }

        if (!sessionData) {
          resolve({ isAuthenticated: false, error: "Session not found" });
          return;
        }

        const passport = (sessionData as any).passport;
        if (!passport || !passport.user) {
          resolve({ isAuthenticated: false, error: "Not authenticated" });
          return;
        }

        const user = passport.user;
        const claims = user.claims;
        
        if (!claims || !claims.sub) {
          resolve({ isAuthenticated: false, error: "Invalid user claims" });
          return;
        }

        const now = Math.floor(Date.now() / 1000);
        if (user.expires_at && now > user.expires_at) {
          resolve({ isAuthenticated: false, error: "Session expired" });
          return;
        }

        resolve({
          isAuthenticated: true,
          userId: claims.sub,
          userEmail: claims.email,
        });
      });
    });
  } catch (error) {
    return { isAuthenticated: false, error: "Authentication error" };
  }
}

function extractSessionId(signedCookie: string): string | null {
  try {
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
      console.error("[wsAuth] SESSION_SECRET not configured");
      return null;
    }

    let value = signedCookie;
    if (value.startsWith("s:")) {
      value = value.slice(2);
    }
    
    const unsigned = cookieSignature.unsign(value, secret);
    
    if (unsigned === false) {
      console.warn("[wsAuth] Cookie signature verification failed - possible tampering attempt");
      return null;
    }
    
    return unsigned;
  } catch (error) {
    console.error("[wsAuth] Error verifying cookie signature:", error);
    return null;
  }
}

export function createAuthenticatedWebSocketHandler(
  wss: WebSocketServer,
  requireAuth: boolean = true,
  onConnection: (ws: AuthenticatedWebSocket, request: IncomingMessage) => void
) {
  wss.on("connection", async (ws: WebSocket, request: IncomingMessage) => {
    const authWs = ws as AuthenticatedWebSocket;
    const authResult = await authenticateWebSocket(request);
    
    authWs.isAuthenticated = authResult.isAuthenticated;
    authWs.userId = authResult.userId;
    authWs.userEmail = authResult.userEmail;

    if (requireAuth && !authResult.isAuthenticated) {
      ws.send(JSON.stringify({ 
        type: "auth_error", 
        error: authResult.error || "Authentication required" 
      }));
      ws.close(4001, "Unauthorized");
      return;
    }

    onConnection(authWs, request);
  });
}
