import express, { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { createGenerationSchema } from "../schemas/generation.schema.js";
import { createGenerationsController } from "../controllers/generations.controller.js";

export function createGenerationsRouter({ gateway, limiters, generation }) {
  const router = Router();
  const controller = createGenerationsController(generation);

  // Authentication runs BEFORE body parsing and every handler.
  router.use(requireAuth(gateway));

  router.post(
    "/",
    limiters.generationCreate,
    express.json({ limit: "32kb", strict: true }),
    validateBody(createGenerationSchema),
    controller.create
  );
  router.get("/:jobId", controller.get);
  router.get("/:jobId/events", controller.events);
  router.post("/:jobId/cancel", limiters.generationControl, controller.cancel);
  router.post("/:jobId/retry", limiters.generationCreate, controller.retry);

  return router;
}
