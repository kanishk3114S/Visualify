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
  }, deps.tickMs ?? 750);

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

  // 4. Composing: compile sections concurrently (bounded) with linked sibling abort and global CLI semaphore.
  await onStage("composing", STAGE_PROGRESS.composing);
  const warnings = [...(extractedSource?.warnings ?? []), ...plan.warnings];
  const step = Math.floor((STAGE_PROGRESS.persisting - STAGE_PROGRESS.composing) / plan.sections.length);
  const compiledEntries = new Array(plan.sections.length);
  const sectionConcurrency = Math.min(3, plan.sections.length);
  const siblingController = new AbortController();
  const onParentAbort = () => siblingController.abort(signal?.reason);
  if (signal?.aborted) siblingController.abort(signal.reason);
  else signal?.addEventListener("abort", onParentAbort, { once: true });

  const semaphore = deps.renderSemaphore ?? null;
  let nextIndex = 0;
  let completedCount = 0;

  async function compileWorker() {
    while (true) {
      if (siblingController.signal.aborted || signal?.aborted) {
        throw cancelled(signal);
      }
      const index = nextIndex;
      nextIndex += 1;
      if (index >= plan.sections.length) return;
      const section = plan.sections[index];
      try {
        const invokeCompile = () =>
          deps.compileSection(section.diagramSpec, {
            signal: siblingController.signal,
            visualStyle,
          });
        const compiled = semaphore
          ? await semaphore.run(invokeCompile, { signal: siblingController.signal })
          : await invokeCompile();
        if (siblingController.signal.aborted || signal?.aborted) {
          throw cancelled(signal);
        }
        const ownTitle = typeof section.diagramSpec.title === "string" ? section.diagramSpec.title.trim().toLowerCase() : null;
        const title = ownTitle && ownTitle === section.title.trim().toLowerCase() ? null : section.title;
        compiledEntries[index] = {
          part: {
            sectionId: section.id,
            title,
            frameName: `${index + 1}. ${section.title}`,
            visualType: section.visualType,
            scene: compiled.scene,
          },
          strategy: compiled.strategy,
          mermaidBlock: compiled.mermaidSource ? `%% section: ${section.id}\n${compiled.mermaidSource}` : null,
        };
      } catch (err) {
        if (signal?.aborted || siblingController.signal.aborted || err?.name === "AbortError" || err?.code === "CLI_CANCELLED" || err?.code === "CANCELLED") {
          siblingController.abort(signal?.reason ?? err);
          throw cancelled(signal);
        }
        compiledEntries[index] = {
          warning: `The diagram for "${section.title}" couldn't be drawn; its explanation is still included.`,
        };
      }
      completedCount += 1;
      onProgress(STAGE_PROGRESS.composing + step * completedCount);
    }
  }

  try {
    await Promise.all(Array.from({ length: sectionConcurrency }, () => compileWorker()));
  } catch (err) {
    // Abort any running or queued siblings immediately on cancel or fatal failure.
    siblingController.abort(err);
    throw err;
  } finally {
    signal?.removeEventListener("abort", onParentAbort);
  }
  throwIfAborted(signal);

  const parts = [];
  const mermaidBlocks = [];
  const strategies = {};
  for (let i = 0; i < plan.sections.length; i++) {
    const entry = compiledEntries[i];
    if (!entry) continue;
    if (entry.warning) {
      warnings.push(entry.warning);
    } else if (entry.part) {
      parts.push(entry.part);
      strategies[plan.sections[i].id] = entry.strategy;
      if (entry.mermaidBlock) mermaidBlocks.push(entry.mermaidBlock);
    }
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
      model: planned.model ?? null,
      primaryModel: planned.primaryModel ?? planned.model ?? null,
      attempts: planned.attempts ?? 1,
      failedOver: Boolean(planned.failedOver),
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
