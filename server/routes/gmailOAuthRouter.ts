import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { storage } from '../storage';
import crypto from 'crypto';

const router = Router();

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/userinfo.email'
];

const pendingStates = new Map<string, { userId: string; expiresAt: number }>();

function getOAuth2Client() {
  // Determine the correct domain for OAuth callback
  let redirectUri: string;
  
  if (process.env.REPLIT_DEV_DOMAIN) {
    // Development environment
    redirectUri = `https://${process.env.REPLIT_DEV_DOMAIN}/api/oauth/google/gmail/callback`;
  } else if (process.env.REPLIT_DOMAINS) {
    // Production environment - use first domain from comma-separated list
    const primaryDomain = process.env.REPLIT_DOMAINS.split(',')[0].trim();
    redirectUri = `https://${primaryDomain}/api/oauth/google/gmail/callback`;
  } else if (process.env.BASE_URL) {
    redirectUri = `${process.env.BASE_URL}/api/oauth/google/gmail/callback`;
  } else {
    redirectUri = 'http://localhost:5000/api/oauth/google/gmail/callback';
  }
  
  console.log('[Gmail OAuth] Using redirect URI:', redirectUri);
    
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

router.get('/start', async (req: Request, res: Response) => {
  // Get userId from Passport session (req.user.claims.sub)
  const user = (req as any).user;
  const userId = user?.claims?.sub;
  
  console.log('[Gmail OAuth] Start - user:', user ? 'present' : 'missing', 'userId:', userId);
  
  if (!userId) {
    // Redirect to login page with return URL
    res.redirect('/?auth_required=gmail');
    return;
  }

  const state = crypto.randomBytes(32).toString('hex');
  pendingStates.set(state, { 
    userId, 
    expiresAt: Date.now() + 10 * 60 * 1000
  });

  const oauth2Client = getOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SCOPES,
    state,
    prompt: 'consent'
  });

  // Redirect directly to Google OAuth (for browser navigation)
  res.redirect(authUrl);
});

// JSON endpoint for programmatic access (like React hooks)
router.get('/start-json', async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = user?.claims?.sub;
  
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const state = crypto.randomBytes(32).toString('hex');
  pendingStates.set(state, { 
    userId, 
    expiresAt: Date.now() + 10 * 60 * 1000
  });

  const oauth2Client = getOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SCOPES,
    state,
    prompt: 'consent'
  });

  res.json({ authUrl });
});

router.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

  if (error) {
    res.redirect('/?gmail_error=' + encodeURIComponent(String(error)));
    return;
  }

  if (!code || !state) {
    res.redirect('/?gmail_error=missing_params');
    return;
  }

  const pending = pendingStates.get(String(state));
  if (!pending || pending.expiresAt < Date.now()) {
    pendingStates.delete(String(state));
    res.redirect('/?gmail_error=invalid_state');
    return;
  }

  pendingStates.delete(String(state));

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(String(code));
    
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    if (!email) {
      res.redirect('/?gmail_error=no_email');
      return;
    }

    await storage.saveGmailOAuthToken({
      userId: pending.userId,
      accountEmail: email,
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      expiresAt: new Date(tokens.expiry_date!),
      scopes: GMAIL_SCOPES
    });

    console.log(`[Gmail OAuth] Successfully connected ${email} for user ${pending.userId}`);
    res.redirect('/?gmail_connected=true');
  } catch (error: any) {
    console.error('[Gmail OAuth] Callback error:', error);
    res.redirect('/?gmail_error=' + encodeURIComponent(error.message));
  }
});

router.get('/status', async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = user?.claims?.sub;
  
  if (!userId) {
    res.json({ connected: false, useCustomOAuth: true });
    return;
  }

  try {
    const token = await storage.getGmailOAuthToken(userId);
    
    if (!token) {
      res.json({ connected: false, useCustomOAuth: true });
      return;
    }

    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      expiry_date: token.expiresAt.getTime()
    });
    
    // Check if token needs refresh (expires within 5 minutes)
    const now = Date.now();
    const expiryTime = token.expiresAt.getTime();
    if (expiryTime - now < 5 * 60 * 1000 && token.refreshToken) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        
        // Update stored token with new access token
        await storage.saveGmailOAuthToken({
          userId,
          accountEmail: token.accountEmail,
          accessToken: credentials.access_token!,
          refreshToken: token.refreshToken,
          expiresAt: new Date(credentials.expiry_date || Date.now() + 3600000),
          scopes: token.scopes
        });
        
        oauth2Client.setCredentials(credentials);
        console.log('[Gmail OAuth] Token refreshed for user', userId);
      } catch (refreshError) {
        console.error('[Gmail OAuth] Token refresh failed:', refreshError);
        // Token refresh failed, user needs to reconnect
        res.json({ 
          connected: false, 
          error: 'Token expired and refresh failed. Please reconnect.',
          useCustomOAuth: true 
        });
        return;
      }
    }
    
    const gmailClient = google.gmail({ version: 'v1', auth: oauth2Client });
    await gmailClient.users.labels.list({ userId: 'me' });

    res.json({
      connected: true,
      email: token.accountEmail,
      scopes: token.scopes,
      useCustomOAuth: true,
      hasFullPermissions: true
    });
  } catch (error: any) {
    console.error('[Gmail OAuth] Status check error:', error);
    res.json({ 
      connected: false, 
      error: error.message,
      useCustomOAuth: true 
    });
  }
});

router.post('/disconnect', async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = user?.claims?.sub;
  
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const token = await storage.getGmailOAuthToken(userId);
    
    if (token) {
      try {
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: token.accessToken });
        await oauth2Client.revokeCredentials();
      } catch (e) {
        console.log('[Gmail OAuth] Token revocation failed (may already be revoked)');
      }
      
      await storage.deleteGmailOAuthToken(userId);
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Gmail OAuth] Disconnect error:', error);
    res.status(500).json({ error: error.message });
  }
});

setInterval(() => {
  const now = Date.now();
  const entries = Array.from(pendingStates.entries());
  for (const [state, data] of entries) {
    if (data.expiresAt < now) {
      pendingStates.delete(state);
    }
  }
}, 60000);

export default router;
