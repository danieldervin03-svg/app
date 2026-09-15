import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, setToken, User } from "@/src/api";
import { storage } from "@/src/utils/storage";

const USER_KEY = "bp_user";

type AuthState = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string, role?: "user" | "coach") => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: User) => void;
};

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const bootstrap = useCallback(async () => {
    try {
      const cached = await storage.getItem<string>(USER_KEY, "");
      if (cached) {
        try {
          setUserState(JSON.parse(cached));
        } catch {}
      }
      const fresh = await api.me();
      setUserState(fresh);
      await storage.setItem(USER_KEY, JSON.stringify(fresh));
    } catch {
      setUserState(null);
      await setToken(null);
      await storage.removeItem(USER_KEY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const signIn = async (email: string, password: string) => {
    const res = await api.login({ email, password });
    await setToken(res.token);
    await storage.setItem(USER_KEY, JSON.stringify(res.user));
    setUserState(res.user);
  };

  const signUp = async (email: string, password: string, name: string, role: "user" | "coach" = "user") => {
    const res = await api.register({ email, password, name, role });
    await setToken(res.token);
    await storage.setItem(USER_KEY, JSON.stringify(res.user));
    setUserState(res.user);
  };

  const signOut = async () => {
    await setToken(null);
    await storage.removeItem(USER_KEY);
    setUserState(null);
  };

  const refresh = async () => {
    const u = await api.me();
    setUserState(u);
    await storage.setItem(USER_KEY, JSON.stringify(u));
  };

  const setUser = (u: User) => {
    setUserState(u);
    storage.setItem(USER_KEY, JSON.stringify(u));
  };

  return (
    <AuthCtx.Provider value={{ user, loading, signIn, signUp, signOut, refresh, setUser }}>
      {children}
    </AuthCtx.Provider>
  );
}

// Neutral fallback returned when useAuth() is evaluated outside the real
// AuthProvider tree (e.g. Expo Router's SDK 55 static route discovery, which
// can render/inspect screen modules outside the app's actual component tree).
// loading stays true and the actions are no-ops so callers relying on the
// normal "wait for auth" flow keep working instead of crashing.
const FALLBACK_AUTH_STATE: AuthState = {
  user: null,
  loading: true,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
  refresh: async () => {},
  setUser: () => {},
};

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) {
    console.log("⚠️ useAuth FALLBACK utilisé");
    return FALLBACK_AUTH_STATE;
  }
  return ctx;
}
