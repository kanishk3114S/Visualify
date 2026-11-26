import { AppError } from "../utils/errors.js";

export const PROFILE_COLUMNS = "id, display_name, username, avatar_path, bio, preferences, created_at, updated_at";

const PG_UNIQUE_VIOLATION = "23505";
const PG_CHECK_VIOLATION = "23514";

/** Wraps a database error into a safe AppError (raw details stay in logs). */
function databaseError(error) {
  if (error?.code === PG_CHECK_VIOLATION) {
    return new AppError(400, "VALIDATION_ERROR", "Some fields are invalid.", { cause: error });
  }
  return new AppError(502, "DATABASE_ERROR", "We couldn't complete that request. Please try again.", { cause: error });
}

/** Truncate by code points (matches Postgres char_length), never splitting surrogate pairs. */
const truncate = (value, max) => Array.from(value).slice(0, max).join("");

/** Same fallback order as public.handle_new_user(), capped at the column limit. */
export function deriveDisplayName(user) {
  const meta = user?.metadata ?? {};
  for (const candidate of [meta.display_name, meta.full_name, meta.name]) {
    if (typeof candidate === "string" && candidate.trim()) return truncate(candidate.trim(), 80);
  }
  const local = typeof user?.email === "string" ? user.email.split("@")[0] : "";
  return truncate(local, 80);
}

export async function findProfile(db, userId) {
  const { data, error } = await db.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle();
  if (error) throw databaseError(error);
  return data;
}

/**
 * Same as getOrCreateProfile, also returning `{ profile, created }` so the caller
 * can emit `auth_signup_completed` cleanly once on first profile creation.
 */
export async function getOrCreateProfileWithMeta(db, user) {
  const existing = await findProfile(db, user.id);
  if (existing) return { profile: existing, created: false };

  const { data, error } = await db
    .from("profiles")
    .insert({ id: user.id, display_name: deriveDisplayName(user) })
    .select(PROFILE_COLUMNS)
    .single();
  if (!error) return { profile: data, created: true };
  if (error.code === PG_UNIQUE_VIOLATION) {
    const raced = await findProfile(db, user.id);
    if (raced) return { profile: raced, created: false };
  }
  throw databaseError(error);
}

/**
 * Returns the caller's profile, creating it if the signup trigger never ran
 * (e.g. account predates the migration). RLS restricts the insert to id = auth.uid().
 */
export async function getOrCreateProfile(db, user) {
  const { profile } = await getOrCreateProfileWithMeta(db, user);
  return profile;
}

/**
 * Applies an allowlisted patch to the caller's own row. `userId` always comes
 * from the verified token, never from the request body.
 */
export async function updateProfile(db, userId, patch) {
  const { data, error } = await db
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select(PROFILE_COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      throw new AppError(409, "USERNAME_TAKEN", "That username is already taken.", {
        details: [{ field: "username", message: "That username is already taken." }],
        cause: error,
      });
    }
    throw databaseError(error);
  }
  if (!data) throw new AppError(404, "PROFILE_NOT_FOUND", "Profile not found.");
  return data;
}

/** Merges a partial preferences patch over the stored preferences object. */
export function mergePreferences(current, patch) {
  const base = current && typeof current === "object" && !Array.isArray(current) ? current : {};
  return { ...base, ...patch };
}

/** Public shape returned by the API. avatar_path (internal storage key) is not exposed. */
export function toProfileDto(row, { email, avatar, isAdmin = false }) {
  return {
    id: row.id,
    email: email ?? null,
    display_name: row.display_name,
    username: row.username,
    bio: row.bio,
    preferences: row.preferences,
    avatar_url: avatar?.url ?? null,
    avatar_url_expires_at: avatar?.expiresAt ?? null,
    isAdmin: Boolean(isAdmin),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
