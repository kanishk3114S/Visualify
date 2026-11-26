import express, { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { deleteAccountSchema, profilePatchSchema } from "../schemas/profile.schema.js";
import { createMeController } from "../controllers/me.controller.js";

export function createMeRouter({ config, gateway, limiters, usageService = null, accountService = null }) {
  const router = Router();
  const controller = createMeController(config, { usageService, accountService });

  // Memory storage: the buffer is magic-byte checked and re-encoded, never written to disk.
  const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.avatarMaxBytes, files: 1, fields: 0, parts: 1 },
  }).single("avatar");

  // Authentication runs BEFORE every handler (and before any upload is buffered).
  router.use(requireAuth(gateway));

  router.get("/", controller.getMe);
  router.get("/usage", controller.getUsage);
  router.delete(
    "/",
    limiters.accountDelete,
    express.json({ limit: "4kb", strict: true }),
    validateBody(deleteAccountSchema),
    controller.deleteAccount
  );
  // JSON is parsed only after authentication, and only where a body is expected.
  router.patch(
    "/",
    limiters.profileMutation,
    express.json({ limit: "16kb", strict: true }),
    validateBody(profilePatchSchema),
    controller.patchMe
  );
  router.post("/avatar", limiters.avatarMutation, avatarUpload, controller.uploadAvatar);
  router.delete("/avatar", limiters.avatarMutation, controller.deleteAvatar);

  return router;
}
