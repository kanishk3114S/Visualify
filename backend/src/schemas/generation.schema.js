import { z } from "zod";
import { SUPPORTED_VISUAL_TYPES } from "@visualify/worker";

export const PROMPT_MAX_CHARS = 8000;

export const GENERATION_OPTIONS = Object.freeze({
  audienceLevel: ["school", "undergraduate", "postgraduate", "professional"],
  detail: ["brief", "standard", "detailed"],
  visualStyle: ["hand_drawn_clean", "minimal"],
  preferredOutput: ["auto", ...SUPPORTED_VISUAL_TYPES],
});

/**
 * FR-IN-01: trim, drop control characters (keeping newlines/tabs), normalise
 * line endings and collapse runs of blank lines / spaces.
 */
export function normalizePrompt(raw) {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{Cc}\n\t]/gu, "")
    .replace(/[ \t]{3,}/g, "  ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const generationSettingsSchema = z
  .strictObject({
    subject: z
      .string()
      .transform((v) => normalizePrompt(v).replace(/\s+/g, " "))
      .pipe(z.string().max(120, "Subject must be at most 120 characters.")),
    audienceLevel: z.enum(GENERATION_OPTIONS.audienceLevel),
    detail: z.enum(GENERATION_OPTIONS.detail),
    visualStyle: z.enum(GENERATION_OPTIONS.visualStyle),
    preferredOutput: z.enum(GENERATION_OPTIONS.preferredOutput),
  })
  .partial()
  .transform((s) => ({
    subject: s.subject ?? "",
    audienceLevel: s.audienceLevel ?? "undergraduate",
    detail: s.detail ?? "standard",
    visualStyle: s.visualStyle ?? "hand_drawn_clean",
    preferredOutput: s.preferredOutput ?? "auto",
  }));

export const createGenerationSchema = z.strictObject({
  inputType: z.literal("prompt", { error: 'inputType must be "prompt".' }),
  prompt: z
    .string({ error: "Enter a topic, question or notes." })
    .transform(normalizePrompt)
    .pipe(
      z
        .string()
        .min(1, "Enter a topic, question or notes.")
        .max(PROMPT_MAX_CHARS, `Prompts can be at most ${PROMPT_MAX_CHARS.toLocaleString("en-US")} characters.`)
    ),
  settings: generationSettingsSchema.optional().transform((s) => s ?? generationSettingsSchema.parse({})),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === "string" && UUID_RE.test(value);
