import { AppError } from "../utils/errors.js";

// Supabase access tokens are JWTs: three base64url segments.
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_TOKEN_LENGTH = 8192;

/** Extracts the token from "Authorization: Bearer <token>", or null. */
export function extractBearerToken(headerValue) {
  if (typeof headerValue !== "string") return null;
  const match = /^Bearer[ ]+(\S+)\s*$/i.exec(headerValue);
  if (!match) return null;
  const token = match[1];
  if (token.length > MAX_TOKEN_LENGTH || !JWT_SHAPE.test(token)) return null;
  return token;
}

/**
 * Authentication middleware. Must be mounted BEFORE any protected handler.
 * Verifies the Supabase access token with Supabase Auth and attaches:
 *   req.user        = { id, email, metadata }   (identity derived ONLY from the token)
 *   req.accessToken = the verified token (for user-scoped RLS clients)
 *   req.db          = RLS-enforced Supabase client acting as that user
 */
export function requireAuth(gateway) {
  return async (req, _res, next) => {
    const token = extractBearerToken(req.get("authorization"));
    if (!token) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required.");
    }
    const user = await gateway.verifyAccessToken(token);
    if (!user) {
      throw new AppError(401, "INVALID_TOKEN", "Your session is invalid or has expired. Please sign in again.");
    }
    req.user = user;
    req.accessToken = token;
    req.db = gateway.createUserClient(token);
    next();
  };
}
