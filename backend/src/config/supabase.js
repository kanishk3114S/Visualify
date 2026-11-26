import { createClient } from "@supabase/supabase-js";
import { AppError } from "../utils/errors.js";

const SERVER_CLIENT_OPTIONS = Object.freeze({
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const HEALTH_TIMEOUT_MS = 3000;
const HEALTH_CACHE_MS = 5000;

/**
 * Builds the Supabase integration used by the API.
 *
 * Every request path uses a *user-scoped* client (publishable key + the
 * caller's verified access token) so Postgres RLS and Storage policies are
 * enforced on top of the API's own ownership checks (defence in depth).
 * The service-role key is deliberately not used in Phase 1.
 */
export function createSupabaseGateway(config, { fetchImpl = globalThis.fetch } = {}) {
  const authClient = createClient(config.supabaseUrl, config.supabasePublishableKey, SERVER_CLIENT_OPTIONS);

  let healthCache = { at: 0, ok: false };

  return {
    /**
     * Verifies a Supabase access token with Supabase Auth.
     * @returns {Promise<{id: string, email: string|null, metadata: object}|null>}
     *   null when the token is invalid/expired/revoked.
     * @throws AppError(503) when Supabase Auth cannot be reached, so an outage
     *   is never misreported to the client as "signed out".
     */
    async verifyAccessToken(token) {
      const { data, error } = await authClient.auth.getUser(token);
      if (error) {
        const status = Number(error.status) || 0;
        if (status >= 400 && status < 500) return null;
        throw new AppError(503, "AUTH_UNAVAILABLE", "Authentication service is temporarily unavailable.", {
          cause: error,
        });
      }
      if (!data?.user?.id) return null;
      return {
        id: data.user.id,
        email: data.user.email ?? null,
        metadata: data.user.user_metadata ?? {},
        appMetadata: data.user.app_metadata ?? {},
        lastSignInAt: data.user.last_sign_in_at ?? null,
      };
    },

    /** Re-authenticates email+password credentials using a non-persisting ephemeral client. */
    async verifyPassword(email, password) {
      if (!email || !password) return false;
      const ephemeral = createClient(config.supabaseUrl, config.supabasePublishableKey, SERVER_CLIENT_OPTIONS);
      const { data, error } = await ephemeral.auth.signInWithPassword({ email, password });
      if (error) {
        const status = Number(error.status) || 0;
        if (status >= 400 && status < 500) return false;
        throw new AppError(503, "AUTH_UNAVAILABLE", "Authentication service is temporarily unavailable.", { cause: error });
      }
      return Boolean(data?.user?.id);
    },

    /** Permanently deletes an auth.users record using the service-role admin API. */
    async deleteAuthUser(userId) {
      if (!config.supabaseServiceRoleKey) {
        throw new AppError(503, "ACCOUNT_DELETE_UNAVAILABLE", "Account deletion requires server configuration.");
      }
      const admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, SERVER_CLIENT_OPTIONS);
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) {
        throw new AppError(502, "ACCOUNT_DELETE_FAILED", "Could not complete account deletion. Please try again.", { cause: error });
      }
    },

    /** RLS-enforced client acting as the verified user. */
    createUserClient(accessToken) {
      return createClient(config.supabaseUrl, config.supabasePublishableKey, {
        ...SERVER_CLIENT_OPTIONS,
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      });
    },

    /**
     * Service-role client for the server-side generation job runner ONLY.
     * Bypasses RLS: every query made with it must filter by a verified owner id.
     * Returns null when the key is not configured.
     */
    createAdminClient() {
      if (!config.supabaseServiceRoleKey) return null;
      return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, SERVER_CLIENT_OPTIONS);
    },

    /** Lightweight reachability probe of Supabase Auth (cached briefly). */
    async checkHealth() {
      const now = Date.now();
      if (now - healthCache.at < HEALTH_CACHE_MS) return healthCache.ok;
      let ok = false;
      try {
        const res = await fetchImpl(`${config.supabaseUrl}/auth/v1/health`, {
          headers: { apikey: config.supabasePublishableKey },
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
      healthCache = { at: now, ok };
      return ok;
    },
  };
}
