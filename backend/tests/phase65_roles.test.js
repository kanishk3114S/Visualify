import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { ensureProcessRoleConfig, loadConfig } from "../src/config/env.js";
import { BullMQGenerationQueue, CANCEL_CHANNEL, EVENTS_CHANNEL } from "../src/generation/bullmqQueue.js";
import { createGenerationService } from "../src/generation/generationService.js";
import { JobEventBus } from "../src/generation/eventBus.js";
import { createGracefulShutdown } from "../src/utils/shutdown.js";
import { createWorkerRuntime } from "../src/worker.js";
import { InMemoryJobStore, createFakePipelineDeps, deferred } from "./helpers/fakeGeneration.js";
import { createLogger } from "../src/utils/logger.js";
import { createFakeSupabase } from "./helpers/fakeSupabase.js";
import { BASE_ENV } from "./helpers/testApp.js";

function createFakeRedisBus() {
  const pubsub = new EventEmitter();
  const bullJobs = new Map();
  let workerFn = null;
  const listeners = new Map();

  function makeSub() {
    const channels = new Set();
    const em = new EventEmitter();
    pubsub.on("msg", (ch, msg) => {
      if (channels.has(ch)) em.emit("message", ch, msg);
    });
    return {
      subscribe: vi.fn(async (ch) => { channels.add(ch); }),
      on: (ev, fn) => em.on(ev, fn),
      quit: vi.fn(async () => {}),
    };
  }

  const connection = {
    ping: vi.fn(async () => "PONG"),
    publish: vi.fn(async (ch, msg) => { pubsub.emit("msg", ch, msg); return 1; }),
    duplicate: () => makeSub(),
    quit: vi.fn(async () => {}),
  };

  class SharedFakeQueue {
    async add(_name, data, opts) {
      const id = opts?.jobId ?? data.jobId;
      if (bullJobs.has(id)) return bullJobs.get(id);
      const entry = {
        id,
        data,
        state: "waiting",
        getState: async () => entry.state,
        remove: async () => { bullJobs.delete(id); },
      };
      bullJobs.set(id, entry);
      setTimeout(() => drain(), 5);
      return entry;
    }
    async getJob(id) { return bullJobs.get(id) ?? null; }
    async close() {}
  }

  async function drain() {
    if (!workerFn) return;
    for (const entry of bullJobs.values()) {
      if (entry.state !== "waiting") continue;
      entry.state = "active";
      Promise.resolve()
        .then(() => workerFn(entry))
        .then(() => { entry.state = "completed"; })
        .catch((err) => {
          entry.state = "failed";
          listeners.get("failed")?.(entry, err);
        });
    }
  }

  class SharedFakeWorker {
    constructor(_name, fn) {
      workerFn = fn;
    }
    on(ev, fn) { listeners.set(ev, fn); }
    async pause() {}
    async close() {}
  }

  return { connection, SharedFakeQueue, SharedFakeWorker, bullJobs };
}

describe("Phase 6.5 §3: Process roles (api/worker), cross-process cancel, health server & SIGTERM shutdown", () => {
  it("refuses to boot PROCESS_ROLE=api or worker in production without REDIS_URL", () => {
    const prodApiNoRedis = loadConfig({
      ...BASE_ENV,
      NODE_ENV: "production",
      PROCESS_ROLE: "api",
      SUPABASE_SERVICE_ROLE_KEY: "srv_prod_key_value_here",
    });
    expect(() => ensureProcessRoleConfig(prodApiNoRedis)).toThrow(/REDIS_URL is required/);

    const prodWorkerNoRedis = loadConfig({
      ...BASE_ENV,
      NODE_ENV: "production",
      PROCESS_ROLE: "worker",
      SUPABASE_SERVICE_ROLE_KEY: "srv_prod_key_value_here",
    });
    expect(() => ensureProcessRoleConfig(prodWorkerNoRedis)).toThrow(/REDIS_URL is required/);

    const prodApiWithRedis = loadConfig({
      ...BASE_ENV,
      NODE_ENV: "production",
      PROCESS_ROLE: "api",
      REDIS_URL: "redis://localhost:6379",
      SUPABASE_SERVICE_ROLE_KEY: "srv_prod_key_value_here",
    });
    expect(() => ensureProcessRoleConfig(prodApiWithRedis)).not.toThrow();
  });

  it("split api + worker: api never creates BullMQ Worker, worker executes job, and api cancel aborts job on worker via Redis", async () => {
    const sharedStore = new InMemoryJobStore();
    const sharedRedis = createFakeRedisBus();
    const pipelineDeps = createFakePipelineDeps(sharedStore);
    pipelineDeps.gate = deferred();

    const apiCfg = loadConfig({ ...BASE_ENV, PROCESS_ROLE: "api", REDIS_URL: "redis://localhost:6379" });
    const workerCfg = loadConfig({ ...BASE_ENV, PROCESS_ROLE: "worker", REDIS_URL: "redis://localhost:6379", WORKER_HEALTH_PORT: "5501" });

    // API queue (runWorker: false -> worker MUST be null)
    const apiBus = new JobEventBus();
    const apiQueue = new BullMQGenerationQueue({
      connection: sharedRedis.connection,
      runWorker: false,
      QueueClass: sharedRedis.SharedFakeQueue,
      WorkerClass: sharedRedis.SharedFakeWorker,
      subClient: sharedRedis.connection.duplicate(),
      onRemoteEvent: (jobId, evt) => apiBus.publish(jobId, evt),
    });
    expect(apiQueue.worker).toBeNull();
    const apiService = createGenerationService({
      config: apiCfg,
      store: sharedStore,
      queue: apiQueue,
      bus: apiBus,
      pipelineDeps,
    });

    // Worker runtime (runWorker: true -> fetches row via getJobForRunner)
    let workerServiceRef = null;
    const workerBus = new JobEventBus();
    const workerQueue = new BullMQGenerationQueue({
      connection: sharedRedis.connection,
      runWorker: true,
      QueueClass: sharedRedis.SharedFakeQueue,
      WorkerClass: sharedRedis.SharedFakeWorker,
      subClient: sharedRedis.connection.duplicate(),
      recoverHandler: async (jobId) => (signal) => workerServiceRef.runJobById(jobId, signal),
    });
    expect(workerQueue.worker).toBeTruthy();
    workerServiceRef = createGenerationService({
      config: workerCfg,
      store: sharedStore,
      queue: workerQueue,
      bus: workerBus,
      pipelineDeps,
    });

    const apiEvents = [];
    const job = await apiService.createJob({
      ownerId: "00000000-0000-4000-8000-000000000001",
      prompt: "Explain BGP",
      settings: {},
    });
    const unsub = apiBus.subscribe(job.id, (e) => apiEvents.push(e));

    // Wait until worker reaches planning gate on the separate role
    await new Promise((r) => setTimeout(r, 40));
    expect(apiEvents.some((e) => e.type === "stage" && e.data.stage === "planning")).toBe(true);

    // Issue cancel ONLY on API role -> publishes Redis CANCEL_CHANNEL -> aborts job on worker role
    const cancelOut = await apiService.cancelJob({
      db: null,
      ownerId: "00000000-0000-4000-8000-000000000001",
      jobId: job.id,
    });
    expect(cancelOut.status).toBe("cancelling");
    expect(sharedRedis.connection.publish).toHaveBeenCalledWith(CANCEL_CHANNEL, job.id);

    await new Promise((r) => setTimeout(r, 40));
    unsub();
    const finalRow = sharedStore.rows.get(job.id);
    expect(finalRow.status).toBe("cancelled");
  });

  it("worker runtime exposes /healthz & /readyz and SIGTERM waits within SHUTDOWN_GRACE_MS or marks interrupted on timeout", async () => {
    const fakeSupa = createFakeSupabase();
    const cfg = loadConfig({ ...BASE_ENV, PROCESS_ROLE: "worker", WORKER_HEALTH_PORT: "5502", SHUTDOWN_GRACE_MS: "1000" });
    const logger = createLogger(cfg);
    const store = new InMemoryJobStore();
    const bus = new JobEventBus();
    const gate = deferred();
    let aborted = false;
    const queue = {
      pending: 0,
      running: true,
      onIdle() {
        return gate.promise;
      },
      pause: vi.fn(async () => {}),
      close: vi.fn(async () => { aborted = true; }),
    };
    const genSvc = createGenerationService({
      config: cfg,
      store,
      queue,
      bus,
      pipelineDeps: createFakePipelineDeps(store),
      logger,
    });

    const rt = createWorkerRuntime({
      config: cfg,
      gateway: fakeSupa.gateway,
      redis: { ping: async () => "PONG", quit: async () => {} },
      logger,
      generation: { service: genSvc, queue, store, bus, mode: "bullmq" },
    });

    await rt.start();
    const addr = rt.healthServer.address();
    const hz = await fetch(`http://127.0.0.1:${addr.port}/healthz`);
    expect(hz.status).toBe(200);
    const rz = await fetch(`http://127.0.0.1:${addr.port}/readyz`);
    expect(rz.status).toBe(200);

    // 1. Clean drain within graceMs exits 0
    let exitCode = null;
    const cleanShutdown = createGracefulShutdown({
      graceMs: 500,
      httpServer: rt.healthServer,
      generation: { service: genSvc, queue },
      onExit: (c) => { exitCode = c; },
    });
    setTimeout(() => gate.resolve(), 20);
    await cleanShutdown("SIGTERM");
    expect(exitCode).toBe(0);

    // 2. Grace timeout marks leftover active jobs INTERRUPTED and exits 1
    const stuckJob = await store.insertJob({ ownerId: "u1", prompt: "stuck", settings: {} });
    await store.updateJob(stuckJob.id, { status: "planning", stage: "planning" });
    const stuckPromise = new Promise(() => {}); // never settles
    let timedExit = null;
    const forceShutdown = createGracefulShutdown({
      graceMs: 30,
      generation: {
        service: {
          onIdle: () => stuckPromise,
          shutdown: () => {},
          recoverInterruptedJobs: () => genSvc.recoverInterruptedJobs(),
        },
        queue: { pause: async () => {} },
      },
      onExit: (c) => { timedExit = c; },
    });
    await forceShutdown("SIGTERM");
    expect(timedExit).toBe(1);
    expect(store.rows.get(stuckJob.id).status).toBe("failed");
    expect(store.rows.get(stuckJob.id).error_code).toBe("INTERRUPTED");
    expect(aborted).toBe(true);
  });
});
