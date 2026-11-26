import { Router } from "express";
import { createHealthRouter } from "./health.routes.js";
import { createMeRouter } from "./me.routes.js";
import { createGenerationsRouter } from "./generations.routes.js";
import { createExportsRouter, createFoldersRouter, createNotesRouter } from "./notes.routes.js";
import { createSourcesRouter } from "./sources.routes.js";
import { createAdminRouter } from "./admin.routes.js";

/** Mounts every /api/v1 route. */
export function createApiRouter(deps) {
  const router = Router();
  router.use("/health", createHealthRouter(deps));
  router.use("/me", createMeRouter(deps));
  router.use("/sources", createSourcesRouter(deps));
  router.use("/generations", createGenerationsRouter(deps));
  router.use("/folders", createFoldersRouter(deps));
  router.use("/notes", createNotesRouter(deps));
  router.use("/exports", createExportsRouter(deps));
  router.use("/admin", createAdminRouter(deps));
  return router;
}
