import { createClient } from "@supabase/supabase-js";
import { env, envProblems } from "./env.js";

export const AUTH_STORAGE_KEY = "visualify-auth";

/**
 * Single browser Supabase client (publishable key only - RLS protects data).
 * Session persistence and token refresh are handled entirely by supabase-js;
 * the app never builds its own refresh loop (PRD 5.1 implementation note).
 * PKCE: OAuth / email-link / recovery codes are exchanged automatically on
 * load (detectSessionInUrl) by the page they land on.
 */
export const supabase =
  envProblems.length === 0
    ? createClient(env.supabaseUrl, env.supabasePublishableKey, {
        auth: {
          flowType: "pkce",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: AUTH_STORAGE_KEY,
        },
      })
    : null;
