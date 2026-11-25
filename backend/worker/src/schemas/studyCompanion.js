import { z } from "zod";
import { LearningPlanSectionSchema, SourceRefSchema, sanitizeForGemini } from "./learningPlan.js";

const slug = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/);

export const ExplainSelectionOutputSchema = z
  .object({
    explanation: z.string().trim().min(1).max(1600),
    analogy: z.string().trim().max(700).default(""),
    keyPoint: z.string().trim().min(1).max(260),
    relatedConcepts: z.array(z.string().trim().min(1).max(100)).max(6).default([]),
  })
  .strict();

export const QuizQuestionSchema = z
  .object({
    id: slug,
    question: z.string().trim().min(1).max(400),
    options: z.array(z.string().trim().min(1).max(220)).length(4),
    correctIndex: z.number().int().min(0).max(3),
    explanation: z.string().trim().min(1).max(500),
    sectionId: z.string().trim().max(64).nullable().default(null),
    concept: z.string().trim().max(120).default(""),
    sourceRefs: z.array(SourceRefSchema).max(5).default([]),
  })
  .strict();

export const QuizOutputSchema = z
  .object({
    questions: z.array(QuizQuestionSchema).min(3).max(8),
  })
  .strict();

export const FlashcardItemSchema = z
  .object({
    front: z.string().trim().min(1).max(500),
    back: z.string().trim().min(1).max(1500),
    hint: z.string().trim().max(300).default(""),
    sectionId: z.string().trim().max(64).nullable().default(null),
    concept: z.string().trim().max(120).default(""),
  })
  .strict();

export const FlashcardsOutputSchema = z
  .object({
    cards: z.array(FlashcardItemSchema).min(4).max(12),
  })
  .strict();

export const RevisionGuideOutputSchema = z
  .object({
    summary: z.string().trim().min(1).max(1600),
    keyTerms: z
      .array(
        z
          .object({
            term: z.string().trim().min(1).max(120),
            definition: z.string().trim().min(1).max(500),
          })
          .strict()
      )
      .min(1)
      .max(15),
    commonConfusions: z
      .array(
        z
          .object({
            misconception: z.string().trim().min(1).max(320),
            correction: z.string().trim().min(1).max(450),
          })
          .strict()
      )
      .min(1)
      .max(8),
    selfCheck: z
      .array(
        z
          .object({
            question: z.string().trim().min(1).max(320),
            answer: z.string().trim().min(1).max(600),
          })
          .strict()
      )
      .min(3)
      .max(6),
  })
  .strict();

export const AskNoteCitationSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    sectionId: z.string().trim().max(64).nullable().default(null),
    snippet: z.string().trim().max(240).default(""),
    pages: z.array(z.number().int().positive()).max(10).optional(),
  })
  .strict();

export const AskNoteOutputSchema = z
  .object({
    answer: z.string().trim().min(1).max(2000),
    grounded: z.boolean(),
    citations: z.array(AskNoteCitationSchema).max(8).default([]),
  })
  .strict();

export const SectionRegenerateOutputSchema = LearningPlanSectionSchema;

export const companionJsonSchema = (schema) => sanitizeForGemini(z.toJSONSchema(schema));

/**
 * Extracts a compact, coordinate-free summary of selected Excalidraw elements
 * (and their direct text/arrow labels) so AI selection explanations stay tight.
 */
export function summarizeSelectedElements(selectedElements = [], allElements = []) {
  const byId = new Map((allElements ?? []).filter((e) => e && !e.isDeleted).map((e) => [e.id, e]));
  const picked = (selectedElements ?? []).filter((e) => e && !e.isDeleted).slice(0, 25);
  const out = [];
  let charBudget = 0;

  for (const el of picked) {
    const boundText = (el.boundElements ?? [])
      .filter((b) => b?.type === "text")
      .map((b) => byId.get(b.id)?.text)
      .filter(Boolean);
    const arrowText = (el.boundElements ?? [])
      .filter((b) => b?.type === "arrow")
      .map((b) => {
        const arr = byId.get(b.id);
        if (!arr) return null;
        const label = (arr.boundElements ?? []).map((ab) => byId.get(ab.id)?.text).filter(Boolean).join(" ");
        const fromText = arr.startBinding?.elementId ? findElementLabel(byId, arr.startBinding.elementId) : null;
        const toText = arr.endBinding?.elementId ? findElementLabel(byId, arr.endBinding.elementId) : null;
        if (!fromText && !toText && !label) return null;
        return `${fromText ?? "?"} -[${label || "link"}]-> ${toText ?? "?"}`;
      })
      .filter(Boolean);

    const text = [el.text, ...boundText].filter(Boolean).join(" · ").trim().slice(0, 240);
    const entry = {
      id: String(el.id ?? "").slice(0, 80),
      type: String(el.type ?? "unknown").slice(0, 24),
      ...(text ? { text } : {}),
      ...(arrowText.length ? { connections: arrowText.slice(0, 4) } : {}),
    };
    const serializedLen = JSON.stringify(entry).length;
    if (charBudget + serializedLen > 3200) break;
    charBudget += serializedLen;
    out.push(entry);
  }
  return out;
}

function findElementLabel(byId, id) {
  const el = byId.get(id);
  if (!el) return null;
  if (typeof el.text === "string" && el.text.trim()) return el.text.trim().slice(0, 60);
  for (const b of el.boundElements ?? []) {
    const child = byId.get(b.id);
    if (child?.type === "text" && child.text?.trim()) return child.text.trim().slice(0, 60);
  }
  return el.id?.slice(0, 32) ?? null;
}

/**
 * Builds bounded textual context from a saved note's learning plan, current
 * canvas text labels, and optional source metadata for grounded companion calls.
 */
export function buildCompactNoteContext({ title, learningPlan, sceneJson, sourceFile = null }) {
  const sections = (learningPlan?.sections ?? []).map((s) => {
    const prefix = `${s.id}__`;
    const canvasLabels = (sceneJson?.elements ?? [])
      .filter((e) => e && !e.isDeleted && e.type === "text" && e.id?.startsWith(prefix) && !e.id.endsWith("__title") && !e.id.endsWith("__badge_txt") && !e.id.endsWith("__type_txt"))
      .map((e) => e.text?.trim())
      .filter(Boolean)
      .slice(0, 30);
    return {
      id: s.id,
      title: s.title,
      visualType: s.visualType,
      explanation: s.explanation,
      keyConcepts: s.keyConcepts ?? [],
      relationships: s.relationships ?? [],
      sourceRefs: s.sourceRefs ?? [],
      canvasLabels: [...new Set(canvasLabels)],
    };
  });

  // Also include user-added canvas text elements outside generated sections.
  const sectionPrefixes = (learningPlan?.sections ?? []).map((s) => `${s.id}__`);
  const extraCanvasText = (sceneJson?.elements ?? [])
    .filter(
      (e) =>
        e &&
        !e.isDeleted &&
        e.type === "text" &&
        e.text?.trim() &&
        !sectionPrefixes.some((p) => e.id?.startsWith(p))
    )
    .map((e) => e.text.trim().slice(0, 160))
    .slice(0, 30);

  return {
    title: title || learningPlan?.title || "Untitled visual note",
    summary: learningPlan?.summary ?? "",
    learningObjectives: learningPlan?.learningObjectives ?? [],
    sourceName: sourceFile?.originalName ?? null,
    pageCount: sourceFile?.pageCount ?? null,
    sections,
    extraCanvasText,
  };
}
