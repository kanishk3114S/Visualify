import { GoogleGenAI } from "@google/genai";
import { getGeminiConfig } from "../config/env.js";
import {
  LearningPlanSchema,
  SUPPORTED_VISUAL_TYPES,
  getLearningPlanGeminiJsonSchema,
} from "../schemas/learningPlan.js";

const SYSTEM_INSTRUCTION = `You are Visualify's educational visual learning planner.
Given a topic or educational prompt, produce a concise, pedagogically structured learning plan as valid JSON matching the provided JSON Schema.

Rules:
1. Choose the best visualType for each section from: ${SUPPORTED_VISUAL_TYPES.join(", ")}.
2. Ensure section.visualType matches section.diagramSpec.kind identically.
3. Keep diagrams readable and uncluttered (prefer 4-10 nodes/concepts per section).
4. Ensure all IDs are unique alphanumeric/hyphen/underscore slugs and every edge/message/relation references defined node/participant/entity IDs.
5. Never invent ungrounded sourceRefs for plain prompt inputs (use an empty array []).
6. Return ONLY valid JSON matching the schema.`;

export class GeminiPlannerError extends Error {
  constructor(
    message,
    { code = "GEMINI_ERROR", status = null, retryable = false, cause = null, details = null } = {}
  ) {
    super(message, { cause });
    this.name = "GeminiPlannerError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

function extractResponseText(response) {
  if (!response) return "";
  if (typeof response.text === "string") {
    return response.text;
  }
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (Array.isArray(parts)) {
    return parts
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .join("")
      .trim();
  }
  return "";
}

function classifyProviderError(err) {
  const status = err?.status || err?.code;
  const msg = String(err?.message || err || "");

  if (err?.name === "AbortError" || /timeout|aborted/i.test(msg)) {
    return new GeminiPlannerError("Gemini API request timed out", {
      code: "PROVIDER_TIMEOUT",
      status: 504,
      retryable: true,
      cause: err,
    });
  }
  if (status === 429 || /rate limit|quota|resource_exhausted/i.test(msg)) {
    return new GeminiPlannerError("Gemini API rate limit or quota exceeded", {
      code: "PROVIDER_RATE_LIMIT",
      status: 429,
      retryable: false,
      cause: err,
    });
  }
  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /UNAVAILABLE|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(msg)
  ) {
    return new GeminiPlannerError(`Gemini API transient error: ${msg}`, {
      code: "PROVIDER_TRANSIENT_ERROR",
      status: typeof status === "number" ? status : 503,
      retryable: true,
      cause: err,
    });
  }
  return new GeminiPlannerError(`Gemini API request failed: ${msg}`, {
    code: "PROVIDER_API_ERROR",
    status: typeof status === "number" ? status : null,
    retryable: false,
    cause: err,
  });
}

async function callModelWithTimeout({
  client,
  model,
  contents,
  jsonSchema,
  timeoutMs,
  maxTransientRetries = 2,
  retryBaseDelayMs = 800,
}) {
  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema,
          temperature: 0.2,
          abortSignal: controller.signal,
        },
      });

      const candidate = response?.candidates?.[0];
      if (
        candidate?.finishReason &&
        ["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST"].includes(
          candidate.finishReason
        )
      ) {
        throw new GeminiPlannerError(
          `Gemini response blocked (${candidate.finishReason})`,
          { code: "MODEL_RESPONSE_BLOCKED" }
        );
      }

      const rawText = extractResponseText(response);
      if (!rawText.trim()) {
        throw new GeminiPlannerError("Gemini returned an empty response", {
          code: "EMPTY_MODEL_RESPONSE",
        });
      }

      return { rawText, usageMetadata: response?.usageMetadata || null };
    } catch (err) {
      const classified =
        err instanceof GeminiPlannerError ? err : classifyProviderError(err);

      if (classified.retryable && attempt < maxTransientRetries) {
        attempt += 1;
        const delayMs = retryBaseDelayMs * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      throw classified;
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseAndValidatePlan(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    return {
      ok: false,
      stage: "json_parse",
      errors: [`Invalid JSON: ${err.message}`],
    };
  }

  const result = LearningPlanSchema.safeParse(parsed);
  if (!result.success) {
    const formatted = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`
    );
    return {
      ok: false,
      stage: "schema_validation",
      errors: formatted,
    };
  }

  return { ok: true, data: result.data };
}

/**
 * Generates and validates a structured learning plan from a user prompt using Gemini.
 * Allows at most ONE bounded repair attempt if JSON parsing or Zod validation fails.
 */
export async function generateLearningPlan({
  prompt,
  preferredVisualTypes = SUPPORTED_VISUAL_TYPES,
  client = null,
  model = null,
  timeoutMs = 30_000,
  maxTransientRetries = 2,
  retryBaseDelayMs = 800,
} = {}) {
  const cleanPrompt = typeof prompt === "string" ? prompt.trim() : "";
  if (!cleanPrompt) {
    throw new GeminiPlannerError("Prompt must be a non-empty string", {
      code: "INVALID_INPUT",
    });
  }

  let resolvedClient = client;
  let resolvedModel = model;
  if (!resolvedClient) {
    const cfg = getGeminiConfig();
    resolvedClient = new GoogleGenAI({ apiKey: cfg.apiKey });
    resolvedModel = resolvedModel || cfg.model;
  } else {
    resolvedModel = resolvedModel || process.env.GEMINI_MODEL || "gemini-3.5-flash";
  }

  const jsonSchema = getLearningPlanGeminiJsonSchema();
  const startedAt = Date.now();

  const initialContents = `Topic / learning prompt:
${cleanPrompt}

Preferred visual types to consider: ${preferredVisualTypes.join(", ")}.
Produce 1 to 2 clear educational sections with complete diagramSpec definitions.`;

  const firstAttempt = await callModelWithTimeout({
    client: resolvedClient,
    model: resolvedModel,
    contents: initialContents,
    jsonSchema,
    timeoutMs,
    maxTransientRetries,
    retryBaseDelayMs,
  });

  const firstValidation = parseAndValidatePlan(firstAttempt.rawText);
  if (firstValidation.ok) {
    return {
      plan: firstValidation.data,
      model: resolvedModel,
      repaired: false,
      latencyMs: Date.now() - startedAt,
      usageMetadata: firstAttempt.usageMetadata,
    };
  }

  // Bounded single repair attempt using explicit validation feedback
  const repairContents = `Your previous JSON output failed validation.
Errors:
- ${firstValidation.errors.slice(0, 12).join("\n- ")}

Invalid output:
${firstAttempt.rawText.slice(0, 8000)}

Fix ONLY the validation errors above and return a complete valid JSON learning plan matching the schema.`;

  const repairAttempt = await callModelWithTimeout({
    client: resolvedClient,
    model: resolvedModel,
    contents: repairContents,
    jsonSchema,
    timeoutMs,
    maxTransientRetries,
    retryBaseDelayMs,
  });

  const repairValidation = parseAndValidatePlan(repairAttempt.rawText);
  if (repairValidation.ok) {
    return {
      plan: repairValidation.data,
      model: resolvedModel,
      repaired: true,
      latencyMs: Date.now() - startedAt,
      usageMetadata: repairAttempt.usageMetadata,
    };
  }

  throw new GeminiPlannerError(
    `Learning plan failed validation after 1 bounded repair attempt: ${repairValidation.errors.join("; ")}`,
    {
      code: "SCHEMA_VALIDATION_FAILED",
      details: repairValidation.errors,
    }
  );
}
