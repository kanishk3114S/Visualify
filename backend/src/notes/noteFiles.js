import { AppError } from "../utils/errors.js";

export const NOTE_ASSETS_BUCKET = "note-assets";
export const NOTE_EXPORTS_BUCKET = "note-exports";

const storageError = (cause) =>
  new AppError(502, "STORAGE_ERROR", "We couldn't access your files. Please try again.", { cause });

/**
 * Private note file storage through the caller's RLS-scoped Storage client.
 * Only object paths are persisted; downloads use short-lived signed URLs.
 */
export function createSupabaseNoteFiles(storage) {
  return {
    async upload(bucket, path, buffer, contentType) {
      const { error } = await storage.from(bucket).upload(path, buffer, { contentType, upsert: true, cacheControl: "300" });
      if (error) throw storageError(error);
    },

    /** Removes objects; missing objects are not an error. */
    async remove(bucket, paths) {
      if (!paths.length) return;
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await storage.from(bucket).remove(paths.slice(i, i + 100));
        if (error) throw storageError(error);
      }
    },

    /** Lists every object path under `prefix` (two levels: {prefix}/{versionId}/{file}). */
    async listUnder(bucket, prefix) {
      const { data: dirs, error } = await storage.from(bucket).list(prefix, { limit: 1000 });
      if (error) throw storageError(error);
      const paths = [];
      for (const entry of dirs ?? []) {
        if (entry.id) {
          paths.push(`${prefix}/${entry.name}`);
          continue;
        }
        const { data: files, error: e2 } = await storage.from(bucket).list(`${prefix}/${entry.name}`, { limit: 1000 });
        if (e2) throw storageError(e2);
        for (const f of files ?? []) if (f.id) paths.push(`${prefix}/${entry.name}/${f.name}`);
      }
      return paths;
    },

    /** Signed URL, or null if the object cannot be signed (missing/denied). */
    async sign(bucket, path, ttlSeconds, { download } = {}) {
      const { data, error } = await storage.from(bucket).createSignedUrl(path, ttlSeconds, download ? { download } : undefined);
      if (error || !data?.signedUrl) return null;
      return { url: data.signedUrl, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() };
    },

    async signMany(bucket, paths, ttlSeconds) {
      if (!paths.length) return {};
      const { data, error } = await storage.from(bucket).createSignedUrls(paths, ttlSeconds);
      if (error) return {};
      const out = {};
      for (const item of data ?? []) if (item.signedUrl && !item.error) out[item.path] = item.signedUrl;
      return out;
    },
  };
}
