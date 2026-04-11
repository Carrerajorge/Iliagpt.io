

import { createContext, ReactNode, useContext, useEffect, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/schema";

const AUTH_STORAGE_KEY = "siragpt_auth_user";
const ANON_USER_ID_KEY = "siragpt_anon_user_id";
const ANON_TOKEN_KEY = "siragpt_anon_token";
const FORCE_SIGNED_OUT_KEY = "siragpt_force_signed_out";

function isAnonymousUser(user: User | null): boolean {
  if (!user) return false;
  const anyUser = user as any;
  if (anyUser?.isAnonymous === true) return true;
  if (typeof anyUser?.authProvider === "string" && anyUser.authProvider.toLowerCase() === "anonymous") return true;
  if (typeof user.id === "string" && user.id.startsWith("anon_")) return true;
  // Some backends surface anonymous users without a dedicated flag; treat known patterns as anon.
  if (typeof anyUser?.username === "string" && anyUser.username.startsWith("Guest-")) return true;
  return false;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isReady: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => Promise<void>;
  refreshAuth: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// --- Storage Helpers ---

function getStoredUser(): User | null {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function resolveUserAvatarUrl(user: Partial<User> | null | undefined): string | undefined {
  const anyUser = user as any;
  const candidates = [anyUser?.profileImageUrl, anyUser?.avatarUrl];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return undefined;
}

// FRONTEND FIX #5: Only store non-sensitive user data in localStorage
function setStoredUser(user: User | null): void {
  try {
    if (user) {
      const anyUser = user as any;
      // Only store minimal user info, never store tokens or sensitive data
      const safeUserData = {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        firstName: anyUser.firstName,
        username: anyUser.username,
        company: anyUser.company,
        role: user.role,
        plan: user.plan,
        authProvider: anyUser.authProvider,
        profileImageUrl: resolveUserAvatarUrl(user),
        subscriptionPlan: anyUser.subscriptionPlan,
        subscriptionStatus: anyUser.subscriptionStatus,
        subscriptionPeriodEnd: anyUser.subscriptionPeriodEnd,
        subscriptionExpiresAt: anyUser.subscriptionExpiresAt,
        lastLoginAt: anyUser.lastLoginAt,
        createdAt: anyUser.createdAt,
        // Explicitly exclude: password, tokens, secrets, etc.
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(safeUserData));
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

function parseUserPayload(payload: unknown): User | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  if (typeof data.id !== "string" || data.id.trim().length === 0 || data.id.length > 128) {
    return null;
  }
  const profileImageUrl =
    typeof data.profileImageUrl === "string"
      ? data.profileImageUrl
      : typeof data.avatarUrl === "string"
        ? data.avatarUrl
        : undefined;
  return {
    id: data.id,
    email: typeof data.email === "string" ? data.email : undefined,
    fullName: typeof data.fullName === "string" ? data.fullName : undefined,
    firstName: typeof data.firstName === "string" ? data.firstName : undefined,
    username: typeof data.username === "string" ? data.username : undefined,
    company: typeof data.company === "string" ? data.company : undefined,
    role: typeof data.role === "string" ? data.role : undefined,
    plan: typeof data.plan === "string" ? data.plan : undefined,
    profileImageUrl,
    avatarUrl: profileImageUrl,
    isAnonymous: data.isAnonymous === true,
    authProvider: typeof data.authProvider === "string" ? data.authProvider : undefined,
    subscriptionPlan: typeof data.subscriptionPlan === "string" ? data.subscriptionPlan : undefined,
    subscriptionStatus: typeof data.subscriptionStatus === "string" ? data.subscriptionStatus : undefined,
    subscriptionPeriodEnd:
      typeof data.subscriptionPeriodEnd === "string" || data.subscriptionPeriodEnd instanceof Date
        ? (data.subscriptionPeriodEnd as any)
        : undefined,
    subscriptionExpiresAt:
      typeof data.subscriptionExpiresAt === "string" || data.subscriptionExpiresAt instanceof Date
        ? (data.subscriptionExpiresAt as any)
        : undefined,
    lastLoginAt:
      typeof data.lastLoginAt === "string" || data.lastLoginAt instanceof Date
        ? (data.lastLoginAt as any)
        : undefined,
    createdAt:
      typeof data.createdAt === "string" || data.createdAt instanceof Date
        ? (data.createdAt as any)
        : undefined,
  } as User;
}

function clearOldUserData(): void {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function getStoredAnonUserId(): string | null {
  try {
    return localStorage.getItem(ANON_USER_ID_KEY);
  } catch {
    return null;
  }
}

export function getStoredAnonToken(): string | null {
  try {
    return localStorage.getItem(ANON_TOKEN_KEY);
  } catch {
    return null;
  }
}

function setStoredAnonUserId(id: string): void {
  try {
    localStorage.setItem(ANON_USER_ID_KEY, id);
  } catch {
    // Ignore
  }
}

function clearAnonUserId(): void {
  try {
    localStorage.removeItem(ANON_USER_ID_KEY);
    localStorage.removeItem(ANON_TOKEN_KEY);
  } catch {
    // Ignore
  }
}

function setStoredAnonToken(token: string): void {
  try {
    localStorage.setItem(ANON_TOKEN_KEY, token);
  } catch {
    // Ignore
  }
}

function isForcedSignedOut(): boolean {
  try {
    return localStorage.getItem(FORCE_SIGNED_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

function setForcedSignedOut(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(FORCE_SIGNED_OUT_KEY, "1");
    } else {
      localStorage.removeItem(FORCE_SIGNED_OUT_KEY);
    }
  } catch {
    // Ignore
  }
}

// --- Fetch Logic ---

async function fetchUser(): Promise<User | null> {
  const storedAnonId = getStoredAnonUserId();
  const storedToken = getStoredAnonToken();
  const headers: HeadersInit = {};
  if (storedAnonId) {
    headers['X-Anonymous-User-Id'] = storedAnonId;
  }
  if (storedToken) {
    headers['X-Anonymous-Token'] = storedToken;
  }

  const response = await fetch("/api/auth/user", {
    credentials: "include",
    headers,
  });

  if (response.ok) {
    const user = parseUserPayload(await response.json());
    if (!user) {
      clearOldUserData();
      return null;
    }
    setStoredUser(user);
    clearAnonUserId();
    setForcedSignedOut(false);
    return user;
  }

  const tryAnonymousIdentity = async (): Promise<User | null> => {
    try {
      const identityRes = await fetch("/api/session/identity", {
        credentials: "include",
        headers,
      });
      if (identityRes.ok) {
        const identity = await identityRes.json();
        if (identity.userId) {
          setStoredAnonUserId(identity.userId);
          if (identity.token) {
            setStoredAnonToken(identity.token);
          }
          return {
            id: identity.userId,
            isAnonymous: true,
            username: `Guest-${identity.userId.slice(0, 4)}`,
            role: 'user',
          } as User;
        }
      }
    } catch (e) {
      console.error("Failed to get session identity:", e);
    }
    return null;
  };
  
  const params = new URLSearchParams(window.location.search);
  const isLoginRoute = window.location.pathname.startsWith("/login");
  const loggedOut = params.get("logged_out") === "1";

  if (response.status === 401 || response.status === 403) {
    const storedUser = getStoredUser();
    if (storedUser && (storedUser as any).role === "admin") {
      return storedUser;
    }

    clearOldUserData();

    if (loggedOut || isLoginRoute || isForcedSignedOut()) {
      if (loggedOut) setForcedSignedOut(true);
      return null;
    }

    return await tryAnonymousIdentity();
  }

  console.error("Auth fetch failed:", response.status, response.statusText);

  // ✅ Si está forzado signed-out, no intentes Guest tampoco
  if (isForcedSignedOut()) return null;

  return await tryAnonymousIdentity();

}

// --- Provider Component ---

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data: user, isLoading, isFetched, refetch } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    // Always re-validate on mount so a fresh server session is picked up after login redirects.
    refetchOnMount: "always",
    staleTime: 1000 * 30, // 30 seconds (faster updates in dev/OAuth flows)
    initialData: getStoredUser, // Hydrate from local storage initially
    refetchOnWindowFocus: true,
  });

  const login = useCallback(() => {
    window.location.href = "/login";
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore errors
    }
    setForcedSignedOut(true);
    clearAnonUserId();
    setStoredUser(null);
    queryClient.setQueryData(["/api/auth/user"], null);
    queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
    queryClient.clear();
    window.location.href = "/login?logged_out=1";
  }, [queryClient]);

  const refreshAuth = useCallback(async () => {
    // Clear the cache to force a fresh fetch
    queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
    // Force refetch immediately
    await refetch();
  }, [refetch, queryClient]);
  useEffect(() => {
    if (typeof window === "undefined") return;

    const forced = isForcedSignedOut();
    const pathname = window.location.pathname;
    const publicAuthRoute =
      pathname === "/" ||
      [
        "/login",
        "/welcome",
        "/signup",
        "/terms",
        "/privacy-policy",
        "/about",
        "/learn",
        "/pricing",
        "/business",
        "/download",
        "/power",
      ].some((route) => pathname.startsWith(route));

    if (forced && !publicAuthRoute) {
      window.location.replace("/login?logged_out=1");
    }
  }, []);


  // Handle OAuth Callback Logic
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "success") {
      // Invalidate cache to force fresh fetch
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      // Trigger a refetch to get the new user session
      refetch().then((result) => {
        if (result.data) {
          setStoredUser(result.data);
        } else {
          console.warn('[Auth] OAuth callback but no user data received');
        }
      });
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refetch, queryClient]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.dispatchEvent(
      new CustomEvent("auth:changed", {
        detail: {
          userId: user?.id ?? null,
          isAuthenticated: !!user && !isAnonymousUser(user),
        },
      })
    );
  }, [user]);

  const resolvedUser = user ?? null;
  const isReady = isFetched;
  const isAuth = !!user && !isAnonymousUser(user);

  const contextValue = useMemo(() => ({
    user: resolvedUser,
    isLoading,
    isReady,
    isAuthenticated: isAuth,
    login,
    logout,
    refreshAuth,
  }), [resolvedUser, isLoading, isReady, isAuth, login, logout, refreshAuth]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

// --- Hook ---

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
