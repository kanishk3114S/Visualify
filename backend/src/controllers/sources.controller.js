import { sendSuccess } from "../utils/response.js";
import { AppError } from "../utils/errors.js";
import { isUuid } from "../schemas/generation.schema.js";
import {
  SOURCE_COLUMNS,
  SOURCE_FILES_BUCKET,
  createSourceSignedUrl,
  processAndUploadSourceFile,
  toSourceFileDto,
} from "../services/sourceFiles.service.js";

const notFound = () => new AppError(404, "NOT_FOUND", "Source file not found.");

function requireSourceId(req) {
  if (!isUuid(req.params.sourceFileId)) throw notFound();
  return req.params.sourceFileId.toLowerCase();
}

export function createSourcesController(config) {
  return {
    async upload(req, res) {
      const sourceFile = await processAndUploadSourceFile({
        db: req.db,
        userId: req.user.id,
        file: req.file,
        maxBytes: config.sourceMaxBytes,
        signedUrlTtlSeconds: config.sourceSignedUrlTtlSeconds,
        log: req.log,
      });
      res.set("Location", `/api/v1/sources/${sourceFile.id}`);
      return sendSuccess(res, { sourceFile }, 201);
    },

    async get(req, res) {
      const sourceFileId = requireSourceId(req);
      const { data: row, error } = await req.db
        .from("source_files")
        .select(SOURCE_COLUMNS)
        .eq("id", sourceFileId)
        .eq("owner_id", req.user.id)
        .maybeSingle();
      if (error) {
        throw new AppError(502, "DATABASE_ERROR", "We couldn't complete that request. Please try again.", { cause: error });
      }
      if (!row) throw notFound();
      const signed = await createSourceSignedUrl(req.db.storage, row, config.sourceSignedUrlTtlSeconds, req.log);
      return sendSuccess(res, { sourceFile: toSourceFileDto(row, signed) });
    },

    async remove(req, res) {
      const sourceFileId = requireSourceId(req);
      const { data: row, error: selErr } = await req.db
        .from("source_files")
        .select("id, object_path")
        .eq("id", sourceFileId)
        .eq("owner_id", req.user.id)
        .maybeSingle();
      if (selErr) {
        throw new AppError(502, "DATABASE_ERROR", "We couldn't complete that request. Please try again.", { cause: selErr });
      }
      if (!row) throw notFound();

      const { error: storageErr } = await req.db.storage.from(SOURCE_FILES_BUCKET).remove([row.object_path]);
      if (storageErr) {
        throw new AppError(502, "STORAGE_ERROR", "We couldn't delete that file. Please try again.", { cause: storageErr });
      }
      const { error: delErr } = await req.db
        .from("source_files")
        .delete()
        .eq("id", sourceFileId)
        .eq("owner_id", req.user.id);
      if (delErr) {
        throw new AppError(502, "DATABASE_ERROR", "We couldn't complete that request. Please try again.", { cause: delErr });
      }
      return sendSuccess(res, { deleted: true });
    },
  };
}
