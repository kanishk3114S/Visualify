import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { AppError } from "../utils/errors.js";

export const AVATAR_BUCKET = "avatars";
export const AVATAR_OUTPUT_SIZE = 256;
export const AVATAR_MAX_DIMENSION = 4096;
export const ALLOWED_AVATAR_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Server-generated object key: {uid}/avatar-{uuid}.webp (never derived from the filename). */
export function buildAvatarPath(userId) {
  return `${userId}/avatar-${randomUUID()}.webp`;
}

/** True only for keys inside the user's own folder that match the server naming scheme. */
export function isOwnedAvatarPath(userId, objectPath) {
  if (typeof objectPath !== "string" || typeof userId !== "string") return false;
  return new RegExp(`^${userId.replace(/[^0-9a-f-]/gi, "")}/avatar-${UUID}\\.webp$`).test(objectPath);
}

/**
 * Validates the upload by its MAGIC BYTES (not the filename or Content-Type),
 * enforces dimension limits, then re-encodes to a 256x256 WebP. Re-encoding
 * auto-orients from EXIF and drops all metadata (EXIF/GPS/ICC/XMP), and also
 * neutralises any polyglot payload appended to the original file.
 * @returns {Promise<Buffer>}
 */
export async function processAvatarImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError(400, "FILE_REQUIRED", "Choose an image file to upload.");
  }

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_AVATAR_MIME_TYPES.includes(detected.mime)) {
    throw new AppError(415, "UNSUPPORTED_FILE_TYPE", "Upload a JPEG, PNG or WebP image.");
  }

  let metadata;
  try {
    metadata = await sharp(buffer, { failOn: "error" }).metadata();
  } catch (cause) {
    throw new AppError(422, "INVALID_IMAGE", "This image could not be read. Try a different file.", { cause });
  }
  const { width = 0, height = 0 } = metadata;
  if (!width || !height) {
    throw new AppError(422, "INVALID_IMAGE", "This image could not be read. Try a different file.");
  }
  if (width > AVATAR_MAX_DIMENSION || height > AVATAR_MAX_DIMENSION) {
    throw new AppError(
      422,
      "IMAGE_DIMENSIONS_TOO_LARGE",
      `Images can be at most ${AVATAR_MAX_DIMENSION}x${AVATAR_MAX_DIMENSION} pixels.`
    );
  }

  try {
    return await sharp(buffer, {
      failOn: "error",
      limitInputPixels: AVATAR_MAX_DIMENSION * AVATAR_MAX_DIMENSION,
      animated: false,
    })
      .rotate()
      .resize(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, { fit: "cover", position: "centre" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (cause) {
    throw new AppError(422, "INVALID_IMAGE", "This image could not be processed. Try a different file.", { cause });
  }
}

function storageError(cause) {
  return new AppError(502, "STORAGE_ERROR", "We couldn't update your avatar. Please try again.", { cause });
}

export async function uploadAvatarObject(storage, objectPath, webpBuffer) {
  const { error } = await storage.from(AVATAR_BUCKET).upload(objectPath, webpBuffer, {
    contentType: "image/webp",
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw storageError(error);
}

export async function removeAvatarObject(storage, objectPath) {
  const { error } = await storage.from(AVATAR_BUCKET).remove([objectPath]);
  if (error) throw storageError(error);
}

/**
 * Short-lived signed URL for a private avatar. Returns null (never throws) so
 * a missing/broken object degrades to "no avatar" instead of failing /me.
 */
export async function createAvatarSignedUrl(storage, objectPath, ttlSeconds, log) {
  const { data, error } = await storage.from(AVATAR_BUCKET).createSignedUrl(objectPath, ttlSeconds);
  if (error || !data?.signedUrl) {
    log?.warn({ code: "AVATAR_SIGN_FAILED", cause: error?.message }, "could not sign avatar url");
    return null;
  }
  return { url: data.signedUrl, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() };
}
