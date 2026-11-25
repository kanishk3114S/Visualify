import {
  LearningPlanSchema,
  SUPPORTED_VISUAL_TYPES,
  composeLessonScene,
  validateExcalidrawScene,
} from "@visualify/worker";
import { PLANNING_PROGRESS_CEILING, STAGE_PROGRESS } from "./jobStates.js";

class PipelineError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.code = code;
  }
}

/** Distinguishes the job's hard time limit (AbortSignal.timeout) from a user cancel. */
const cancelled = (signal) =>
  Object.assign(new Error("cancelled"), { code: signal?.reason?.name === "TimeoutError" ? "JOB_TIMEOUT" : "CANCELLED" });

function throwIfAborted(signal) {
  if (signal?.aborted) throw cancelled(signal);
}

/** Maps the user's preferredOutput setting to the visual types offered to the planner (FR-AI-02 override). */
export function preferredVisualTypesFor(settings) {
  const choice = settings?.preferredOutput;
  return choice && choice !== "auto" && SUPPORTED_VISUAL_TYPES.includes(choice) ? [choice] : SUPPORTED_VISUAL_TYPES;
}

/**
 * Input (prompt | pdf | image) -> (optional extraction) -> validated learning plan
 * -> per-section scenes -> one validated Excalidraw scene.
 */
export async function runGenerationPipeline({ job, signal, onStage, onProgress, deps }) {
  const startedAt = Date.now();
  const inputType = job.input_type ?? "prompt";
  const visualStyle = job.settings?.visualStyle ?? "hand_drawn_clean";

  // 1. Validating: cheap re-checks before any paid call.
  await onStage("validating", STAGE_PROGRESS.validating);
  throwIfAborted(signal);
  const prompt = typeof job.input_text === "string" ? job.input_text.trim() : "";
  if (inputType === "prompt" && !prompt) throw new PipelineError("INVALID_INPUT", "empty prompt");
  if ((inputType === "pdf" || inputType === "image") && !job.source_file_id) {
    throw new PipelineError("SOURCE_NOT_FOUND", "missing source_file_id");
  }

  // 2. Extracting (PDF & Image inputs only).
  let extractedSource = null;
  if (inputType === "pdf" || inputType === "image") {
    await onStage("extracting", STAGE_PROGRESS.extracting);
    throwIfAborted(signal);
    if (!deps.extractSource) {
      throw new PipelineError("EXTRACTION_FAILED", "source extraction not configured");
    }
    try {
      extractedSource = await deps.extractSource({ job, signal });
    } catch (err) {
      if (signal?.aborted || err?.code === "CANCELLED") throw cancelled(signal);
      throw err;
    }
    throwIfAborted(signal);
  }

  // 3. Planning: one Gemini call (+ at most one bounded repair inside the worker).
  await onStage("planning", STAGE_PROGRESS.planning);
  let progress = STAGE_PROGRESS.planning;
  const ticker = setInterval(() => {
    progress = Math.min(PLANNING_PROGRESS_CEILING, progress + Math.max(1, Math.round((PLANNING_PROGRESS_CEILING - progress) / 6)));
    onProgress(progress);
  }, deps.tickMs ?? 2000);

  let planned;
  try {
    planned = await deps.planner({
      inputType,
      prompt,
      extractedSource,
      settings: job.settings ?? {},
      preferredVisualTypes: preferredVisualTypesFor(job.settings),
      signal,
    });
  } catch (err) {
    if (signal?.aborted || err?.code === "CANCELLED") throw cancelled(signal);
    throw err;
  } finally {
    clearInterval(ticker);
  }
  throwIfAborted(signal);

  const parsed = LearningPlanSchema.safeParse(planned?.plan);
  if (!parsed.success) throw new PipelineError("SCHEMA_VALIDATION_FAILED", "plan failed validation");
  const plan = parsed.data;

  // 4. Composing: each section independently; partial success is allowed.
  await onStage("composing", STAGE_PROGRESS.composing);
  const parts = [];
  const mermaidBlocks = [];
  const warnings = [...(extractedSource?.warnings ?? []), ...plan.warnings];
  const strategies = {};
  const step = Math.floor((STAGE_PROGRESS.persisting - STAGE_PROGRESS.composing) / plan.sections.length);

  for (const [index, section] of plan.sections.entries()) {
    throwIfAborted(signal);
    try {
      const compiled = await deps.compileSection(section.diagramSpec, { signal, visualStyle });
      const ownTitle = typeof section.diagramSpec.title === "string" ? section.diagramSpec.title.trim().toLowerCase() : null;
      const title = ownTitle && ownTitle === section.title.trim().toLowerCase() ? null : section.title;
      parts.push({ sectionId: section.id, title, frameName: `${index + 1}. ${section.title}`, visualType: section.visualType, scene: compiled.scene });
      strategies[section.id] = compiled.strategy;
      if (compiled.mermaidSource) mermaidBlocks.push(`%% section: ${section.id}\n${compiled.mermaidSource}`);
    } catch (err) {
      if (signal?.aborted || err?.code === "CLI_CANCELLED") throw cancelled(signal);
      warnings.push(`The diagram for "${section.title}" couldn't be drawn; its explanation is still included.`);
    }
    onProgress(STAGE_PROGRESS.composing + step * (index + 1));
  }
  if (parts.length === 0) throw new PipelineError("COMPOSE_FAILED", "no section could be composed");

  const scene = composeLessonScene(parts, { visualStyle });
  const validation = validateExcalidrawScene(scene);
  if (!validation.valid) throw new PipelineError("COMPOSE_FAILED", "composed scene failed validation");
  throwIfAborted(signal);

  return {
    plan,
    scene,
    mermaidSource: mermaidBlocks.length ? mermaidBlocks.join("\n\n") : null,
    warnings: [...new Set(warnings)].slice(0, 20),
    modelId: planned.model ?? null,
    promptVersion: planned.promptVersion ?? null,
    usage: {
      durationMs: Date.now() - startedAt,
      plannerLatencyMs: planned.latencyMs ?? null,
      repaired: Boolean(planned.repaired),
      promptTokens: planned.usageMetadata?.promptTokenCount ?? null,
      outputTokens: planned.usageMetadata?.candidatesTokenCount ?? null,
      totalTokens: planned.usageMetadata?.totalTokenCount ?? null,
      sectionsComposed: parts.length,
      sectionsTotal: plan.sections.length,
      strategies,
      inputType,
      selectedPagesCount: extractedSource?.selectedPages?.length ?? 0,
    },
  };
}
