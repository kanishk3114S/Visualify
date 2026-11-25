import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import { createSourcesController } from "../controllers/sources.controller.js";

export function createSourcesRouter({ config, gateway, limiters }) {
  const router = Router();
  const controller = createSourcesController(config);

  const sourceUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.sourceMaxBytes, files: 1, fields: 0, parts: 1 },
  }).single("file");

  // Authentication runs BEFORE multer upload buffering and every handler.
  router.use(requireAuth(gateway));

  router.post("/upload", limiters.sourcesUpload, sourceUpload, controller.upload);
  router.get("/:sourceFileId", controller.get);
  router.delete("/:sourceFileId", limiters.sourcesUpload, controller.remove);

  return router;
}
