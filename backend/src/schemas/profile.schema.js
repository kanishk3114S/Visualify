import { z } from "zod";

/**
 * Server-side validation for profile updates. Mirrors the database CHECK
 * constraints in supabase/migrations/0001_profiles_and_rls.sql so invalid data
 * is rejected with a clear message before it ever reaches Postgres.
 */
export const PROFILE_LIMITS = Object.freeze({
  displayNameMax: 80,
  bioMax: 300,
  usernamePattern: /^[a-zA-Z0-9_]{3,30}$/,
});

// Control characters (except newline/tab in bio) are never legitimate profile text.
const NO_CONTROL_CHARS = /^[^\p{Cc}]*$/u;
const BIO_ALLOWED_CONTROL = /^(?:[^\p{Cc}]|[\n\t])*$/u;

export const PREFERENCE_OPTIONS = Object.freeze({
  theme: ["light", "dark", "system"],
  defaultExportFormat: ["png", "svg", "excalidraw"],
  learningLevel: ["school", "undergraduate", "postgraduate", "professional"],
});

export const preferencesPatchSchema = z
  .strictObject({
    theme: z.enum(PREFERENCE_OPTIONS.theme),
    defaultExportFormat: z.enum(PREFERENCE_OPTIONS.defaultExportFormat),
    learningLevel: z.enum(PREFERENCE_OPTIONS.learningLevel),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one preference to update." });

export const profilePatchSchema = z
  .strictObject({
    display_name: z
      .string()
      .trim()
      .max(PROFILE_LIMITS.displayNameMax, `Display name must be at most ${PROFILE_LIMITS.displayNameMax} characters.`)
      .regex(NO_CONTROL_CHARS, "Display name contains invalid characters."),
    username: z
      .union([z.string().trim(), z.null()])
      .transform((v) => (v === "" ? null : v))
      .refine((v) => v === null || PROFILE_LIMITS.usernamePattern.test(v), {
        message: "Username must be 3-30 characters: letters, numbers or underscores.",
      }),
    bio: z
      .string()
      .trim()
      .max(PROFILE_LIMITS.bioMax, `Bio must be at most ${PROFILE_LIMITS.bioMax} characters.`)
      .regex(BIO_ALLOWED_CONTROL, "Bio contains invalid characters."),
    preferences: preferencesPatchSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });

export const deleteAccountSchema = z.strictObject({
  confirmation: z.literal("DELETE MY ACCOUNT", { error: 'Type "DELETE MY ACCOUNT" to confirm.' }),
  password: z.string().min(1, "Enter your password.").max(200).optional(),
});
