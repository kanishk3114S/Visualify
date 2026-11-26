import { AppError } from "../utils/errors.js";

export const REAUTH_MAX_AGE_MS = 15 * 60 * 1000;
export const ACCOUNT_STORAGE_BUCKETS = Object.freeze(["avatars", "source-files", "note-assets", "note-exports"]);

async function listBucketPathsRecursive(storageBucket, prefix) {
  const paths = [];
  const queue = [prefix];
  while (queue.length > 0) {
    const dir = queue.shift();
    const { data, error } = await storageBucket.list(dir, { limit: 100 });
    if (error) throw new AppError(502, "STORAGE_ERROR", "Could not enumerate stored files for cleanup.", { cause: error });
    for (const item of data ?? []) {
      const childPath = `${dir}/${item.name}`;
      if (item.id == null) {
        queue.push(childPath);
      } else {
        paths.push(childPath);
      }
    }
  }
  return paths;
}

/**
 * Self-service account deletion (PRD §12.4 & §18.3 launch checklist):
 * 1. Requires explicit re-authentication (password check OR sign-in within 15m).
 * 2. Sweeps every owned object across all 4 private Storage buckets FIRST.
 * 3. Permanently deletes the `auth.users` row (which cascades every user table).
 */
export function createAccountService({ gateway, logger, analyticsService = null }) {
  return {
    async deleteAccount({ user, reqDb, password = null }) {
      let reauthenticated = false;
      if (password && user.email) {
        reauthenticated = await gateway.verifyPassword(user.email, password);
        if (!reauthenticated) {
          throw new AppError(403, "REAUTH_REQUIRED", "Incorrect password. Enter your current password to delete your account.");
        }
      } else if (user.lastSignInAt) {
        const age = Date.now() - new Date(user.lastSignInAt).getTime();
        reauthenticated = Number.isFinite(age) && age >= 0 && age <= REAUTH_MAX_AGE_MS;
      }

      if (!reauthenticated) {
        throw new AppError(
          403,
          "REAUTH_REQUIRED",
          "Recent sign-in or password confirmation is required before deleting your account."
        );
      }

      const admin = gateway.createAdminClient?.() ?? null;
      const storage = admin?.storage ?? reqDb?.storage;
      let removedObjects = 0;

      if (storage) {
        for (const bucketName of ACCOUNT_STORAGE_BUCKETS) {
          const bucket = storage.from(bucketName);
          if (!bucket?.list) continue;
          const paths = await listBucketPathsRecursive(bucket, user.id);
          if (paths.length > 0) {
            for (let i = 0; i < paths.length; i += 100) {
              const chunk = paths.slice(i, i + 100);
              const { error } = await bucket.remove(chunk);
              if (error) {
                throw new AppError(502, "STORAGE_ERROR", "Could not remove all stored files. Account deletion aborted.", {
                  cause: error,
                });
              }
            }
            removedObjects += paths.length;
          }
        }
      }

      analyticsService?.record("account_deleted", null, { removedObjects });
      await analyticsService?.flush?.();
      await gateway.deleteAuthUser(user.id);
      logger?.info({ userId: user.id, event: "account_deleted", removedObjects }, "account deleted");
      return { deleted: true, removedObjects };
    },
  };
}
