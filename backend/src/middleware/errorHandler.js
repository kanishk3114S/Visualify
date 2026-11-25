import multer from "multer";
import { AppError } from "../utils/errors.js";
import { sendError } from "../utils/response.js";

const MULTER_ERRORS = {
  LIMIT_FILE_SIZE: [413, "FILE_TOO_LARGE", "This file exceeds the current upload limit."],
  LIMIT_FILE_COUNT: [400, "TOO_MANY_FILES", "Upload a single image file."],
  LIMIT_UNEXPECTED_FILE: [400, "UNEXPECTED_FILE_FIELD", 'Upload the image in the "avatar" field.'],
  LIMIT_PART_COUNT: [400, "INVALID_UPLOAD", "The upload request is malformed."],
  LIMIT_FIELD_COUNT: [400, "INVALID_UPLOAD", "The upload request is malformed."],
  LIMIT_FIELD_KEY: [400, "INVALID_UPLOAD", "The upload request is malformed."],
  LIMIT_FIELD_VALUE: [400, "INVALID_UPLOAD", "The upload request is malformed."],
};

/** Maps any thrown value to a safe status/code/message triple. */
function classify(err) {
  if (err instanceof AppError) return [err.status, err.code, err.message, err.details];
  if (err instanceof multer.MulterError) {
    const [status, code, message] = MULTER_ERRORS[err.code] ?? [400, "INVALID_UPLOAD", "The upload request is malformed."];
    return [status, code, message, null];
  }
  // body-parser errors
  if (err?.type === "entity.parse.failed") return [400, "INVALID_JSON", "Request body must be valid JSON.", null];
  if (err?.type === "entity.too.large") return [413, "PAYLOAD_TOO_LARGE", "Request body is too large.", null];
  if (err?.type === "encoding.unsupported" || err?.type === "charset.unsupported") {
    return [415, "UNSUPPORTED_ENCODING", "Unsupported request encoding.", null];
  }
  // Multipart stream parse failures from busboy
  if (typeof err?.message === "string" && /^(Unexpected end of form|Multipart: Boundary not found|Malformed part header)/.test(err.message)) {
    return [400, "INVALID_UPLOAD", "The upload request is malformed.", null];
  }
  return [500, "INTERNAL_ERROR", "Something went wrong", null];
}

export function notFoundHandler(_req, res) {
  sendError(res, 404, "NOT_FOUND", "The requested resource was not found.");
}

/**
 * Global error handler. Responses NEVER include stack traces, SQL/provider
 * errors, file paths or library names; full details go to server logs only.
 */
export function errorHandler(err, req, res, _next) {
  const [status, code, message, details] = classify(err);
  const log = req.log ?? console;
  if (status >= 500) {
    log.error({ err, code, userId: req.user?.id }, "request failed");
  } else {
    log.warn({ code, status, userId: req.user?.id, cause: err?.cause?.message }, "request rejected");
  }
  if (res.headersSent) return;
  sendError(res, status, code, message, details);
}
