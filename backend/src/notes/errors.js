import { AppError } from "../utils/errors.js";

export const notFound = (what = "Note") => new AppError(404, "NOT_FOUND", `${what} not found.`);

/**
 * Maps Postgres / PostgREST errors from the notes domain to safe API errors.
 * Raw messages never reach the client; they stay on `cause` for server logs.
 */
export function mapNotesDbError(error, { entity = "Note" } = {}) {
  const code = error?.code;
  const message = String(error?.message ?? "");
  if (code === "P0002" || code === "PGRST116" || code === "22P02") return notFound(entity);
  if (code === "23514" && message.includes("folder_cycle")) {
    return new AppError(400, "FOLDER_CYCLE", "A folder can't be moved into itself or one of its subfolders.", { cause: error });
  }
  if (code === "23514" && message.includes("folder_too_deep")) {
    return new AppError(400, "FOLDER_TOO_DEEP", "Folders can be nested at most 8 levels deep.", { cause: error });
  }
  if (code === "23505" && message.includes("folders_unique_sibling_name")) {
    return new AppError(409, "FOLDER_NAME_TAKEN", "A folder with that name already exists here.", { cause: error });
  }
  if (code === "23505" && message.includes("note_versions_one_note_per_job")) {
    return new AppError(409, "JOB_ALREADY_SAVED", "This visual is already in your library.", { cause: error });
  }
  if (code === "23503") return new AppError(404, "FOLDER_NOT_FOUND", "Folder not found.", { cause: error });
  if (code === "22023" && message.includes("job_not_completed")) {
    return new AppError(409, "JOB_NOT_COMPLETED", "Only completed generations can be saved.", { cause: error });
  }
  if (code === "23514" || code === "22001") {
    return new AppError(400, "VALIDATION_ERROR", "Some fields are invalid.", { cause: error });
  }
  return new AppError(502, "DATABASE_ERROR", "We couldn't complete that request. Please try again.", { cause: error });
}
