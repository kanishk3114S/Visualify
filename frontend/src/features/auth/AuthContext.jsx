import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase.js";

const AuthContext = createContext(null);

/**
 * Single source of auth truth. Driven exclusively by supabase.auth
 * onAuthStateChange (INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT…);
 * the subscription is removed on unmount. status starts as "loading" so route
 * guards can wait instead of flashing protected UI.
 */
export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState({ status: "loading", session: null });

  useEffect(() => {
    if (!supabase) {
      setState({ status: "unauthenticated", session: null });
      return undefined;
    }
    let active = true;
    // Never call other supabase.auth methods synchronously inside this
    // callback (supabase-js holds a lock while notifying subscribers).
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      setState({ status: session ? "authenticated" : "unauthenticated", session: session ?? null });
      if (event === "SIGNED_OUT") {
        // Drop every cached, user-scoped response (profile, signed URLs…).
        queryClient.clear();
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [queryClient]);

  const value = useMemo(
    () => ({
      status: state.status,
      session: state.session,
      user: state.session?.user ?? null,
      signOut: async ({ everywhere = false } = {}) => {
        const { error } = await supabase.auth.signOut({ scope: everywhere ? "global" : "local" });
        if (error) throw error;
      },
    }),
    [state]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
