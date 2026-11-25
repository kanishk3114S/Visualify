/** Job state machine (PRD 11.2), mirrored by the CHECK constraint in 0003 + 0006. */
export const ACTIVE_STATUSES = Object.freeze([
  "queued",
  "validating",
  "extracting",
  "planning",
  "composing",
  "rendering",
  "persisting",
  "cancelling",
]);
export const TERMINAL_STATUSES = Object.freeze(["completed", "failed", "cancelled"]);
export const RUNNING_STATUSES = Object.freeze([
  "validating",
  "extracting",
  "planning",
  "composing",
  "rendering",
  "persisting",
]);

export const isActive = (status) => ACTIVE_STATUSES.includes(status);
export const isTerminal = (status) => TERMINAL_STATUSES.includes(status);

/** Stage -> progress floor. Progress never moves backwards. */
export const STAGE_PROGRESS = Object.freeze({
  queued: 0,
  validating: 5,
  extracting: 12,
  planning: 22,
  composing: 65,
  persisting: 92,
  completed: 100,
});

/** Upper bound for the simulated progress ticks while waiting on the model. */
export const PLANNING_PROGRESS_CEILING = 58;

/**
 * Internal / provider error code -> safe, user-facing code and message.
 * Messages never include provider text, stack traces or paths.
 */
const SAFE_ERRORS = {
  PROVIDER_TIMEOUT: ["GENERATION_TIMEOUT", "The AI service took too long to respond. Please try again."],
  JOB_TIMEOUT: ["GENERATION_TIMEOUT", "This generation took too long and was stopped. Please try again."],
  PROVIDER_RATE_LIMIT: ["AI_BUSY", "The AI service is busy right now. Please try again in a few minutes."],
  PROVIDER_TRANSIENT_ERROR: ["AI_UNAVAILABLE", "The AI service is temporarily unavailable. Please try again."],
  PROVIDER_API_ERROR: ["AI_UNAVAILABLE", "The AI service couldn't process this request. Please try again."],
  MODEL_RESPONSE_BLOCKED: ["CONTENT_BLOCKED", "This request couldn't be turned into a visual. Try rephrasing your topic."],
  EMPTY_MODEL_RESPONSE: ["INVALID_PLAN", "We couldn't build a valid visual plan for this topic. Please try again or rephrase it."],
  SCHEMA_VALIDATION_FAILED: ["INVALID_PLAN", "We couldn't build a valid visual plan for this topic. Please try again or rephrase it."],
  COMPOSE_FAILED: ["RENDER_FAILED", "We couldn't draw a diagram for this topic. Please try again or rephrase it."],
  INTERRUPTED: ["INTERRUPTED", "This generation was interrupted before it finished. Please retry."],
  CORRUPT_FILE: ["CORRUPT_FILE", "This file could not be read. Try uploading a clean PDF or image."],
  ENCRYPTED_PDF: ["ENCRYPTED_PDF", "This PDF is password-protected. Remove the password and upload it again."],
  PAGE_LIMIT_EXCEEDED: ["PAGE_LIMIT_EXCEEDED", "Too many PDF pages were selected. Select up to 100 pages and try again."],
  INVALID_PAGE_RANGE: ["INVALID_PAGE_RANGE", "The selected page range is outside this PDF's page count."],
  EMPTY_SOURCE: ["EMPTY_SOURCE", "No readable text or visual content was found in this file."],
  EXTRACTION_FAILED: ["EXTRACTION_FAILED", "We couldn't extract content from this file. Please try another file."],
  SOURCE_NOT_FOUND: ["SOURCE_NOT_FOUND", "The uploaded source file could not be found. Please upload it again."],
};

export function toSafeError(err) {
  const internal = err?.code;
  const [code, message] = SAFE_ERRORS[internal] ?? ["GENERATION_FAILED", "Something went wrong while generating your visual. Please try again."];
  return { code, message, internalCode: typeof internal === "string" ? internal : "UNKNOWN" };
}
