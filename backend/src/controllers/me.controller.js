import { sendSuccess } from "../utils/response.js";
import { AppError } from "../utils/errors.js";
import {
  getOrCreateProfile,
  mergePreferences,
  toProfileDto,
  updateProfile,
} from "../services/profile.service.js";
import {
  buildAvatarPath,
  createAvatarSignedUrl,
  isOwnedAvatarPath,
  processAvatarImage,
  removeAvatarObject,
  uploadAvatarObject,
} from "../services/avatar.service.js";

/**
 * Controllers for /api/v1/me*. Identity ALWAYS comes from req.user (verified
 * token); req.db is the RLS-scoped client for that same user.
 */
export function createMeController(config, { usageService = null, accountService = null } = {}) {
  const ttl = config.avatarSignedUrlTtlSeconds;

  async function respondWithProfile(req, res, row, status = 200) {
    const avatar =
      row.avatar_path && isOwnedAvatarPath(req.user.id, row.avatar_path)
        ? await createAvatarSignedUrl(req.db.storage, row.avatar_path, ttl, req.log)
        : null;
    return sendSuccess(res, { profile: toProfileDto(row, { email: req.user.email, avatar }) }, status);
  }

  return {
    async getMe(req, res) {
      const row = await getOrCreateProfile(req.db, req.user);
      return respondWithProfile(req, res, row);
    },

    async patchMe(req, res) {
      const current = await getOrCreateProfile(req.db, req.user);
      const patch = { ...req.body };
      if (patch.preferences) patch.preferences = mergePreferences(current.preferences, patch.preferences);
      const row = await updateProfile(req.db, req.user.id, patch);
      return respondWithProfile(req, res, row);
    },

    async uploadAvatar(req, res) {
      if (!req.file) throw new AppError(400, "FILE_REQUIRED", 'Choose an image file to upload in the "avatar" field.');

      const webp = await processAvatarImage(req.file.buffer);
      const current = await getOrCreateProfile(req.db, req.user);
      const previousPath = current.avatar_path;
      const newPath = buildAvatarPath(req.user.id);

      await uploadAvatarObject(req.db.storage, newPath, webp);

      let row;
      try {
        row = await updateProfile(req.db, req.user.id, { avatar_path: newPath });
      } catch (err) {
        // Roll back the orphaned object so storage never diverges from the profile.
        await removeAvatarObject(req.db.storage, newPath).catch((cleanupErr) =>
          req.log?.warn({ code: "AVATAR_ROLLBACK_FAILED", cause: cleanupErr?.message }, "avatar rollback failed")
        );
        throw err;
      }

      if (previousPath && previousPath !== newPath && isOwnedAvatarPath(req.user.id, previousPath)) {
        // Best-effort cleanup; the new avatar is already live.
        await removeAvatarObject(req.db.storage, previousPath).catch((cleanupErr) =>
          req.log?.warn({ code: "AVATAR_CLEANUP_FAILED", cause: cleanupErr?.message }, "old avatar cleanup failed")
        );
      }

      return respondWithProfile(req, res, row, 201);
    },

    async deleteAvatar(req, res) {
      const current = await getOrCreateProfile(req.db, req.user);
      if (!current.avatar_path) return respondWithProfile(req, res, current); // idempotent

      // Remove the object first: the user asked for the image to be gone, so a
      // storage failure must surface instead of silently leaving the file behind.
      if (isOwnedAvatarPath(req.user.id, current.avatar_path)) {
        await removeAvatarObject(req.db.storage, current.avatar_path);
      }
      const row = await updateProfile(req.db, req.user.id, { avatar_path: null });
      return respondWithProfile(req, res, row);
    },

    async getUsage(req, res) {
      if (!usageService) {
        return sendSuccess(res, {
          usage: { limit: config.generationLimitMonthly ?? 50, used: 0, remaining: config.generationLimitMonthly ?? 50, breakdown: { generations: 0, companion: 0, exports: 0 } },
        });
      }
      const usage = await usageService.getMonthlyUsage({ db: req.db, userId: req.user.id });
      return sendSuccess(res, { usage });
    },

    async deleteAccount(req, res) {
      if (!accountService) {
        throw new AppError(503, "ACCOUNT_DELETE_UNAVAILABLE", "Account deletion is unavailable right now.");
      }
      const result = await accountService.deleteAccount({
        user: req.user,
        reqDb: req.db,
        password: req.body?.password ?? null,
      });
      return sendSuccess(res, result);
    },
  };
}
