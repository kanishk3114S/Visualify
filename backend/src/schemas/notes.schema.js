import { z } from "zod";

const NO_CONTROL = /^[^\p{Cc}]*$/u;
const uuid = z.uuid({ error: "Invalid id." });

const title = z.string().trim().min(1, "Enter a title.").max(160, "Titles can be at most 160 characters.").regex(NO_CONTROL, "Title contains invalid characters.");
const shortText = (max) => z.string().trim().max(max, `At most ${max} characters.`).regex(NO_CONTROL, "Contains invalid characters.");
const tag = z.string().trim().toLowerCase().min(1).max(40, "Tags can be at most 40 characters.").regex(/^[\p{L}\p{N} _.+#-]+$/u, "Tags can contain letters, numbers, spaces and - _ . + #");
const tags = z.array(tag).max(20, "At most 20 tags.");
const scene = z.looseObject({ elements: z.array(z.unknown()) }); // deep validation: validateEditableScene

export const folderName = z.string().trim().min(1, "Enter a folder name.").max(80, "Folder names can be at most 80 characters.").regex(NO_CONTROL, "Folder name contains invalid characters.");

export const createFolderSchema = z.strictObject({ name: folderName, parentId: uuid.nullable().optional() });

export const updateFolderSchema = z
  .strictObject({ name: folderName, parentId: uuid.nullable(), sortOrder: z.number().int().min(-1000000).max(1000000) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });

export const createNoteSchema = z.strictObject({
  jobId: uuid,
  title: title.optional(),
  folderId: uuid.nullable().optional(),
  description: shortText(1000).optional(),
  subject: shortText(120).optional(),
  tags: tags.optional(),
  sceneJson: scene.optional(),
});

export const updateNoteSchema = z
  .strictObject({
    title,
    description: shortText(1000),
    subject: shortText(120),
    topic: shortText(120),
    folderId: uuid.nullable(),
    tags,
    isFavorite: z.boolean(),
    isArchived: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });

export const duplicateNoteSchema = z.strictObject({ title: title.optional() });

export const snapshotSchema = z.strictObject({
  sceneJson: scene,
  description: shortText(200).optional(),
});

export const draftSchema = z.strictObject({
  sceneJson: scene,
  baseRevision: z.number().int().min(0).max(2_000_000_000),
});

export const exportSchema = z.strictObject({
  format: z.enum(["png", "svg", "excalidraw", "zip"], { error: "Choose png, svg, excalidraw or zip." }),
  theme: z.enum(["light", "dark"]).default("light"),
  transparent: z.boolean().default(false),
  scope: z.enum(["full", "frame"]).default("full"),
  frameId: z.string().trim().min(1).max(160).optional(),
  slideFormat: z.enum(["png", "svg"]).default("png"),
});

const VISUAL_TYPES = ["flowchart", "sequence", "mindmap", "comparison", "timeline", "er_diagram", "class_diagram"];

export const explainSelectionSchema = z.strictObject({
  selectedElements: z.array(z.looseObject({ id: z.string().max(120) })).min(1, "Select at least one diagram element.").max(25, "Select at most 25 elements."),
  question: shortText(500).optional(),
});

export const quizCreateSchema = z.strictObject({
  difficulty: z.enum(["foundational", "mixed", "challenging"]).default("mixed"),
  questionCount: z.coerce.number().int().min(3).max(8).default(5),
});

export const quizUpdateSchema = z.strictObject({
  answers: z.record(z.string().min(1).max(64), z.number().int().min(0).max(3)),
});

export const flashcardsCreateSchema = z.strictObject({
  cardCount: z.coerce.number().int().min(4).max(12).default(8),
});

export const flashcardUpdateSchema = z.strictObject({
  mastery: z.enum(["new", "review", "known"]),
});

export const askNoteSchema = z.strictObject({
  question: z.string().trim().min(1, "Enter a question.").max(1000, "Questions can be at most 1000 characters.").regex(NO_CONTROL, "Contains invalid characters."),
});

export const regenerateSectionSchema = z.strictObject({
  title: title.optional(),
  explanation: shortText(2000).optional(),
  visualType: z.enum(VISUAL_TYPES).optional(),
  visualStyle: z.enum(["hand_drawn_clean", "editorial_color", "minimal"]).optional(),
  instruction: shortText(600).optional(),
});

/**
 * GET /api/v1/notes query. `q` is reduced to letters, digits, spaces and
 * hyphens so it can be embedded safely in a PostgREST filter expression.
 */
export const listNotesQuerySchema = z.strictObject({
  q: z
    .string()
    .max(200)
    .transform((v) => v.normalize("NFKC").replace(/[^\p{L}\p{N} -]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 100))
    .optional(),
  folderId: z.union([z.literal("root"), uuid]).optional(),
  tags: z
    .string()
    .max(300)
    .transform((v) => [...new Set(v.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))])
    .pipe(z.array(tag).max(5, "Filter by at most 5 tags."))
    .optional(),
  favorite: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  archived: z.enum(["true", "false", "all"]).default("false"),
  sort: z.enum(["updated_at", "created_at", "last_opened_at", "title"]).default("updated_at"),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});
