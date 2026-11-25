import { Router } from "express";
import { createHealthController } from "../controllers/health.controller.js";

export function createHealthRouter({ gateway }) {
  const router = Router();
  const controller = createHealthController(gateway);
  router.get("/", controller.getHealth);
  return router;
}
