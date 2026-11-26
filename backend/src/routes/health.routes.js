import { Router } from "express";
import { createHealthController } from "../controllers/health.controller.js";

export function createHealthRouter({ gateway, config, redis }) {
  const router = Router();
  const controller = createHealthController(gateway, { config, redis });
  router.get("/", controller.getHealth);
  router.get("/live", controller.getLiveness);
  router.get("/ready", controller.getReadiness);
  return router;
}
