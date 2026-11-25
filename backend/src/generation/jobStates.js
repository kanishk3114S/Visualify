/** Job state machine (PRD 11.2), mirrored by the CHECK constraint in 0003. */
export const ACTIVE_STATUSES = Object.freeze(["queued", "validating", "planning", "composing", "rendering", "persisting", "cancelling"]);
export const TERMINAL_STATUSES = Object.freeze(["completed", "failed", "cancelled"]);
export const RUNNING_STATUSES = Object.freeze(["validating", "planning", "composing", "rendering", "persisting"]);

export const isActive = (status) => ACTIVE_STATUSES.includes(status);
export const isTerminal = (status) => TERMINAL_STATUSES.includes(status);

/** Stage -> progress floor. Progress never moves backwards. */
export const STAGE_PROGRESS = Object.freeze({
  queued: 0,
  validating: 5,
  planning: 12,
  composing: 62,
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
};

export function toSafeError(err) {
  const internal = err?.code;
  const [code, message] = SAFE_ERRORS[internal] ?? ["GENERATION_FAILED", "Something went wrong while generating your visual. Please try again."];
  return { code, message, internalCode: typeof internal === "string" ? internal : "UNKNOWN" };
}
