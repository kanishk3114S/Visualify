import { AppError } from "../utils/errors.js";

/** Converts Zod issues into a client-safe list of { field, message }. */
export function formatIssues(error) {
  return error.issues.map((issue) => ({
    field: issue.path.length ? issue.path.join(".") : null,
    message: issue.message,
  }));
}

/** Validates and replaces req.body with the parsed (allowlisted) value. */
export function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Some fields are invalid.", {
        details: formatIssues(result.error),
      });
    }
    req.body = result.data;
    next();
  };
}
