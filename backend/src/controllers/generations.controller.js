import { sendSuccess } from "../utils/response.js";
import { AppError } from "../utils/errors.js";
import { isUuid } from "../schemas/generation.schema.js";
import { toJobDto } from "../generation/generationService.js";
import { isTerminal } from "../generation/jobStates.js";
import { toSourceFileDto } from "../services/sourceFiles.service.js";

export const SSE_HEARTBEAT_MS = 20_000;
const MAX_STREAMS_PER_USER = 5;

const notFound = () => new AppError(404, "NOT_FOUND", "Generation not found.");

/** Unknown, malformed and other users' job IDs all produce the same 404. */
function requireJobId(req) {
  if (!isUuid(req.params.jobId)) throw notFound();
  return req.params.jobId.toLowerCase();
}

function sseWrite(res, type, data, id) {
  if (res.writableEnded) return;
  if (id !== undefined) res.write(`id: ${id}\n`);
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function createGenerationsController({ service, store, bus, heartbeatMs = SSE_HEARTBEAT_MS }) {
  const openStreams = new Map(); // userId -> count

  function ensureEnabled() {
    if (!service.enabled) {
      throw new AppError(503, "GENERATION_UNAVAILABLE", "Visual generation is not available right now. Please try again later.");
    }
  }

  return {
    async create(req, res) {
      ensureEnabled();
      const job = await service.createJob({
        db: req.db,
        ownerId: req.user.id,
        inputType: req.body.inputType,
        prompt: req.body.prompt ?? null,
        sourceFileId: req.body.sourceFileId ?? null,
        pageRange: req.body.pageRange ?? null,
        settings: req.body.settings,
      });
      res.set("Location", `/api/v1/generations/${job.id}`);
      return sendSuccess(res, { jobId: job.id, status: job.status }, 202);
    },

    async get(req, res) {
      const jobId = requireJobId(req);
      const row = await store.getJob({ db: req.db, ownerId: req.user.id, jobId });
      if (!row) throw notFound();
      const job = toJobDto(row);
      if (row.source_file_id && store.getSourceFile) {
        const sf = await store.getSourceFile({ db: req.db, ownerId: req.user.id, sourceFileId: row.source_file_id }).catch(() => null);
        job.sourceFile = sf ? toSourceFileDto(sf) : null;
      }
      return sendSuccess(res, { job });
    },

    async cancel(req, res) {
      const jobId = requireJobId(req);
      const result = await service.cancelJob({ db: req.db, ownerId: req.user.id, jobId });
      if (!result) throw notFound();
      return sendSuccess(res, { jobId, status: result.status }, result.status === "cancelling" ? 202 : 200);
    },

    async retry(req, res) {
      ensureEnabled();
      const jobId = requireJobId(req);
      const job = await service.retryJob({ db: req.db, ownerId: req.user.id, jobId });
      if (!job) throw notFound();
      res.set("Location", `/api/v1/generations/${job.id}`);
      return sendSuccess(res, { jobId: job.id, status: job.status, retryOf: jobId }, 202);
    },

    /**
     * Server-Sent Events. Auth is the normal Bearer header (the client uses
     * fetch + ReadableStream, never a token in the URL). Subscribes BEFORE
     * reading the snapshot so no event can fall between the two.
     */
    async events(req, res) {
      const jobId = requireJobId(req);
      const userId = req.user.id;
      if ((openStreams.get(userId) ?? 0) >= MAX_STREAMS_PER_USER) {
        throw new AppError(429, "TOO_MANY_STREAMS", "Too many open progress streams. Close other tabs and try again.");
      }

      const buffered = [];
      let live = false;
      let seq = 0;
      const unsubscribe = bus.subscribe(jobId, (event) => {
        if (!live) buffered.push(event);
        else forward(event);
      });

      let row;
      try {
        row = await store.getJob({ db: req.db, ownerId: userId, jobId });
      } catch (err) {
        unsubscribe();
        throw err;
      }
      if (!row) {
        unsubscribe();
        throw notFound();
      }

      openStreams.set(userId, (openStreams.get(userId) ?? 0) + 1);
      res.status(200).set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      res.write("retry: 3000\n\n");

      let lastProgress = row.progress ?? 0;
      let closed = false;
      const heartbeat = setInterval(() => !res.writableEnded && res.write(": heartbeat\n\n"), heartbeatMs);

      function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        const n = (openStreams.get(userId) ?? 1) - 1;
        if (n <= 0) openStreams.delete(userId);
        else openStreams.set(userId, n);
      }

      function forward(event) {
        if (closed) return;
        const data = { ...event.data };
        if (typeof data.progress === "number") {
          if (data.progress < lastProgress) data.progress = lastProgress; // monotonic
          lastProgress = data.progress;
        }
        seq += 1;
        sseWrite(res, event.type, data, seq);
        if (["completed", "failed", "cancelled"].includes(event.type)) {
          cleanup();
          res.end();
        }
      }

      req.on("close", cleanup);

      const snapshot = toJobDto(row);
      seq += 1;
      sseWrite(res, "snapshot", { status: snapshot.status, stage: snapshot.stage, progress: snapshot.progress, safeError: snapshot.safeError }, seq);

      if (isTerminal(row.status)) {
        const terminalType = row.status === "completed" ? "completed" : row.status;
        forward({ type: terminalType, data: { status: row.status, progress: row.progress, error: snapshot.safeError ?? undefined } });
        return;
      }
      live = true;
      for (const event of buffered.splice(0)) forward(event);
    },
  };
}
