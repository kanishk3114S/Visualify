import { z } from "zod";

/**
 * Client-side form validation (UX only). The API and database enforce the
 * same rules independently (backend/src/schemas, supabase/migrations).
 */
export const LIMITS = Object.freeze({
  displayNameMax: 80,
  bioMax: 300,
  passwordMin: 8,
  passwordMax: 72, // bcrypt input limit used by Supabase Auth
  avatarMaxBytes: 2 * 1024 * 1024,
});

export const AVATAR_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);

const email = z.string().trim().min(1, "Enter your email address.").email("Enter a valid email address.");

const newPassword = z
  .string()
  .min(LIMITS.passwordMin, `Use at least ${LIMITS.passwordMin} characters.`)
  .max(LIMITS.passwordMax, `Use at most ${LIMITS.passwordMax} characters.`)
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), "Include at least one letter and one number.");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});

export const signupSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, "Enter your name.")
      .max(LIMITS.displayNameMax, `Use at most ${LIMITS.displayNameMax} characters.`),
    email,
    password: newPassword,
    confirmPassword: z.string().min(1, "Confirm your password."),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match.",
  });

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ password: newPassword, confirmPassword: z.string().min(1, "Confirm your new password.") })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match.",
  });

export const profileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .max(LIMITS.displayNameMax, `Use at most ${LIMITS.displayNameMax} characters.`),
  username: z
    .string()
    .trim()
    .refine((v) => v === "" || /^[a-zA-Z0-9_]{3,30}$/.test(v), "3-30 characters: letters, numbers or underscores."),
  bio: z.string().trim().max(LIMITS.bioMax, `Use at most ${LIMITS.bioMax} characters.`),
});

export const preferencesSchema = z.object({
  learningLevel: z.enum(["school", "undergraduate", "postgraduate", "professional"]),
  defaultExportFormat: z.enum(["png", "svg", "excalidraw"]),
});

/** Validates a chosen avatar before upload (UX only; server checks magic bytes). */
export function validateAvatarFile(file) {
  if (!file) return "Choose an image to upload.";
  if (!AVATAR_MIME_TYPES.includes(file.type)) return "Choose a JPEG, PNG or WebP image.";
  if (file.size > LIMITS.avatarMaxBytes) return "Images must be 2 MB or smaller.";
  if (file.size === 0) return "That file is empty.";
  return null;
}
