import { createContext, ReactNode, useContext, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/schema";

const AUTH_STORAGE_KEY = "siragpt_auth_user";
const ANON_USER_ID_KEY = "siragpt_anon_user_id";
const ANON_TOKEN_KEY = "siragpt_anon_token";
const FORCE_SIGNED_OUT_KEY = "siragpt_force_signed_out";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
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

function setStoredUser(user: User | null): void {
  try {
    if (user) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
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
  const headers: HeadersInit = {};
  if (storedAnonId) {
    headers['X-Anonymous-User-Id'] = storedAnonId;
  }

  console.log("[Auth] fetchUser start", {
    hasStoredAnonId: !!storedAnonId,
    path: window.location.pathname,
    search: window.location.search,
  });

  const response = await fetch("/api/auth/user", {
    credentials: "include",
    headers,
  });

  console.log("[Auth] /api/auth/user response", {
    status: response.status,
    ok: response.ok,
  });

  if (response.ok) {
    const user = await response.json();
    console.log("[Auth] /api/auth/user success", {
      id: user?.id,
      email: user?.email,
      role: user?.role,
    });
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
      console.log("[Auth] /api/session/identity response", {
        status: identityRes.status,
        ok: identityRes.ok,
      });
      if (identityRes.ok) {
        const identity = await identityRes.json();
        console.log("[Auth] /api/session/identity payload", identity);
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
          } as unknown as User;
        }
      }
    } catch (e) {
      console.error("Failed to get session identity:", e);
    }
    return null;
  };

  if (response.status === 401 || response.status === 403) {
    const storedUser = getStoredUser();
    if (storedUser && (storedUser as any).role === "admin") {
      return storedUser;
    }
    clearOldUserData();
    if (isForcedSignedOut()) {
      return null;
    }
    return await tryAnonymousIdentity();
  }

  console.error("Auth fetch failed:", response.status, response.statusText);
  if (isForcedSignedOut()) {
    return null;
  }
  return await tryAnonymousIdentity();
}

// --- Provider Component ---

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data: user, isLoading, refetch } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 1000 * 60,
    initialData: getStoredUser,
    refetchOnMount: false,
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

  // Handle OAuth Callback Logic
  useEffect(() => {
    console.log("[Auth] AuthProvider mounted", {
      cachedUser: getStoredUser()?.id ?? null,
      path: window.location.pathname,
      search: window.location.search,
    });
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "success") {
      console.log('[Auth] OAuth callback detected, forcing auth refresh...');
      // Invalidate cache to force fresh fetch
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      // Trigger a refetch to get the new user session
      refetch().then((result) => {
        if (result.data) {
          console.log('[Auth] User authenticated after OAuth:', result.data.email || result.data.id);
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
    console.log("[Auth] AuthProvider state", {
      isLoading,
      hasUser: !!user,
      userId: user?.id ?? null,
      userEmail: (user as any)?.email ?? null,
    });
  }, [isLoading, user]);

  return (
    <AuthContext.Provider value={{
      user: user ?? null,
      isLoading,
      isAuthenticated: !!user,
      login,
      logout,
      refreshAuth
    }}>
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
