/**
 * Operational error with a safe, client-facing code and message.
 * `cause` and any internal detail stay server-side (logged, never returned).
 */
export class AppError extends Error {
  constructor(status, code, message, { details = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}
