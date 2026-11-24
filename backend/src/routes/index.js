import { Router } from "express";
import { createHealthRouter } from "./health.routes.js";
import { createMeRouter } from "./me.routes.js";

/** Mounts every /api/v1 route. */
export function createApiRouter(deps) {
  const router = Router();
  router.use("/health", createHealthRouter(deps));
  router.use("/me", createMeRouter(deps));
  return router;
}
