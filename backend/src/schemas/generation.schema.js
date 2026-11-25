import { z } from "zod";
import { SUPPORTED_VISUAL_TYPES, VISUAL_STYLES } from "@visualify/worker";

export const PROMPT_MAX_CHARS = 8000;
export const GUIDANCE_MAX_CHARS = 2000;

export const GENERATION_OPTIONS = Object.freeze({
  audienceLevel: ["school", "undergraduate", "postgraduate", "professional"],
  detail: ["brief", "standard", "detailed"],
  visualStyle: VISUAL_STYLES,
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

export const pageRangeSchema = z
  .strictObject({
    mode: z.enum(["all", "range", "custom"]).optional(),
    startPage: z.number().int().min(1).max(500).optional(),
    endPage: z.number().int().min(1).max(500).optional(),
    pages: z.array(z.number().int().min(1).max(500)).min(1).max(100).optional(),
    expression: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.startPage !== undefined && val.endPage !== undefined && val.endPage < val.startPage) {
      ctx.addIssue({ code: "custom", path: ["endPage"], message: "End page must be >= start page." });
    }
    if (val.startPage !== undefined && val.endPage !== undefined && val.endPage - val.startPage + 1 > 100) {
      ctx.addIssue({ code: "custom", path: ["endPage"], message: "Select at most 100 pages per generation." });
    }
  });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === "string" && UUID_RE.test(value);

export const createGenerationSchema = z
  .strictObject({
    inputType: z.enum(["prompt", "pdf", "image"], { error: 'inputType must be "prompt", "pdf" or "image".' }),
    prompt: z
      .string()
      .transform(normalizePrompt)
      .pipe(z.string().max(PROMPT_MAX_CHARS, `Prompts can be at most ${PROMPT_MAX_CHARS.toLocaleString("en-US")} characters.`))
      .optional(),
    sourceFileId: z.uuid({ error: "Select a valid uploaded source file." }).optional(),
    pageRange: pageRangeSchema.nullable().optional(),
    settings: generationSettingsSchema.optional().transform((s) => s ?? generationSettingsSchema.parse({})),
  })
  .superRefine((data, ctx) => {
    if (data.inputType === "prompt") {
      if (!data.prompt || data.prompt.length < 1) {
        ctx.addIssue({ code: "custom", path: ["prompt"], message: "Enter a topic, question or notes." });
      }
      if (data.sourceFileId !== undefined) {
        ctx.addIssue({ code: "custom", path: ["sourceFileId"], message: "sourceFileId is not allowed for prompt inputs." });
      }
      if (data.pageRange !== undefined && data.pageRange !== null) {
        ctx.addIssue({ code: "custom", path: ["pageRange"], message: "pageRange is only valid for PDF inputs." });
      }
      return;
    }

    if (!data.sourceFileId) {
      ctx.addIssue({ code: "custom", path: ["sourceFileId"], message: "Upload a source file first." });
    }
    if (data.prompt && data.prompt.length > GUIDANCE_MAX_CHARS) {
      ctx.addIssue({
        code: "custom",
        path: ["prompt"],
        message: `Focus instructions can be at most ${GUIDANCE_MAX_CHARS.toLocaleString("en-US")} characters.`,
      });
    }
    if (data.inputType !== "pdf" && data.pageRange !== undefined && data.pageRange !== null) {
      ctx.addIssue({ code: "custom", path: ["pageRange"], message: "pageRange is only valid for PDF inputs." });
    }
  });
