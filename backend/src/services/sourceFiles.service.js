import { randomUUID } from "node:crypto";
import path from "node:path";
import { inspectSourceBuffer, SourceExtractionError } from "@visualify/worker";
import { AppError } from "../utils/errors.js";

export const SOURCE_FILES_BUCKET = "source-files";

export const SOURCE_COLUMNS =
  "id, owner_id, note_id, bucket, object_path, original_name, mime_type, size_bytes, checksum, page_count, width, height, extraction_status, extracted_metadata, error_code, safe_error_message, created_at, updated_at";

/** Server-generated object key: {uid}/{sourceFileId}/original.{ext}. */
export function buildSourceObjectPath(userId, sourceFileId, ext) {
  return `${userId}/${sourceFileId}/original.${ext}`;
}

/** Sanitizes an uploaded filename for safe metadata display only. */
export function sanitizeOriginalName(rawName) {
  const base = path.basename(String(rawName ?? ""))
    .replace(/[\p{Cc}\/\\]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255);
  return base || "uploaded-source";
}

/** Public source file DTO (never leaks owner_id, bucket, object_path or checksum). */
export function toSourceFileDto(row, signed = null) {
  return {
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    pageCount: row.page_count ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    extractionStatus: row.extraction_status ?? "uploaded",
    extractedMetadata: row.extracted_metadata ?? {},
    previewUrl: signed?.url ?? null,
    previewUrlExpiresAt: signed?.expiresAt ?? null,
    noteId: row.note_id ?? null,
    createdAt: row.created_at,
  };
}

export async function createSourceSignedUrl(storage, row, ttlSeconds, log) {
  if (!row?.object_path || !row.mime_type?.startsWith("image/")) return null;
  const { data, error } = await storage.from(SOURCE_FILES_BUCKET).createSignedUrl(row.object_path, ttlSeconds);
  if (error || !data?.signedUrl) {
    log?.warn({ code: "SOURCE_SIGN_FAILED", cause: error?.message }, "could not sign source preview url");
    return null;
  }
  return { url: data.signedUrl, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() };
}

export async function processAndUploadSourceFile({ db, userId, file, maxBytes, signedUrlTtlSeconds, log }) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new AppError(400, "FILE_REQUIRED", "Choose a PDF or image file to upload.");
  }

  let inspected;
  try {
    inspected = await inspectSourceBuffer(file.buffer, { maxBytes });
  } catch (err) {
    if (err instanceof SourceExtractionError) {
      throw new AppError(err.status, err.code, err.message, { cause: err });
    }
    throw err;
  }

  const sourceFileId = randomUUID();
  const objectPath = buildSourceObjectPath(userId, sourceFileId, inspected.ext);
  const originalName = sanitizeOriginalName(file.originalname);

  const { error: uploadError } = await db.storage.from(SOURCE_FILES_BUCKET).upload(objectPath, inspected.normalizedBuffer, {
    contentType: inspected.mimeType,
    cacheControl: "300",
    upsert: false,
  });
  if (uploadError) {
    throw new AppError(502, "STORAGE_ERROR", "We couldn't store that file. Please try again.", { cause: uploadError });
  }

  const { data: row, error: dbError } = await db
    .from("source_files")
    .insert({
      id: sourceFileId,
      owner_id: userId,
      bucket: SOURCE_FILES_BUCKET,
      object_path: objectPath,
      original_name: originalName,
      mime_type: inspected.mimeType,
      size_bytes: inspected.sizeBytes,
      checksum: inspected.checksum,
      page_count: inspected.pageCount,
      width: inspected.width,
      height: inspected.height,
    })
    .select(SOURCE_COLUMNS)
    .single();

  if (dbError) {
    // Roll back orphaned Storage object if DB insert fails.
    await db.storage.from(SOURCE_FILES_BUCKET).remove([objectPath]).catch(() => {});
    throw new AppError(502, "DATABASE_ERROR", "We couldn't save that file. Please try again.", { cause: dbError });
  }

  const signed = await createSourceSignedUrl(db.storage, row, signedUrlTtlSeconds, log);
  return toSourceFileDto(row, signed);
}
