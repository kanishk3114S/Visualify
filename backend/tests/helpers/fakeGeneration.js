/**
 * Offline test doubles for the generation stack:
 *  - InMemoryJobStore: same interface as SupabaseJobStore, enforcing the same
 *    rules as migration 0003 (owner-scoped reads, ONE active job per owner,
 *    conditional status updates, completed/failed invariants).
 *  - fake pipeline deps: a controllable planner (mock Gemini) and section
 *    compiler (mock Mermaid CLI), so no network or browser is ever used.
 */
import { randomUUID } from "node:crypto";
import { ActiveJobExistsError } from "../../src/generation/jobStore.js";
import { ACTIVE_STATUSES } from "../../src/generation/jobStates.js";
import { JobEventBus } from "../../src/generation/eventBus.js";
import { InProcessQueue } from "../../src/generation/inProcessQueue.js";
import { createGenerationService } from "../../src/generation/generationService.js";

export const SAMPLE_PLAN = Object.freeze({
  schemaVersion: "1.0",
  title: "TCP Three-Way Handshake",
  summary: "How a client and server establish a TCP connection.",
  learningObjectives: ["Identify SYN, SYN-ACK and ACK"],
  sections: [
    {
      id: "handshake",
      title: "Connection establishment",
      visualType: "sequence",
      keyConcepts: ["Client", "Server", "SYN"],
      relationships: [{ from: "Client", to: "Server", label: "SYN" }],
      explanation: "The client sends SYN, the server answers SYN-ACK, the client confirms with ACK.",
      sourceRefs: [],
      diagramSpec: {
        kind: "sequence",
        participants: [
          { id: "client", label: "Client" },
          { id: "server", label: "Server" },
        ],
        messages: [
          { from: "client", to: "server", label: "SYN" },
          { from: "server", to: "client", label: "SYN-ACK" },
        ],
      },
    },
    {
      id: "states",
      title: "TCP vs UDP",
      visualType: "comparison",
      keyConcepts: ["TCP", "UDP"],
      relationships: [],
      explanation: "TCP is connection-oriented; UDP is not.",
      sourceRefs: [],
      diagramSpec: {
        kind: "comparison",
        title: "TCP vs UDP",
        columns: [
          { id: "tcp", title: "TCP", items: [{ label: "Connection", value: "Yes" }] },
          { id: "udp", title: "UDP", items: [{ label: "Connection", value: "No" }] },
        ],
      },
    },
  ],
  warnings: [],
});

const box = (id) => ({ id, type: "rectangle", x: 0, y: 0, width: 120, height: 60 });

export class InMemoryJobStore {
  constructor(supabaseState = null) {
    this.rows = new Map();
    this.fail = {};
    this.supabaseState = supabaseState;
  }

  #maybeFail(op) {
    if (this.fail[op]) throw Object.assign(new Error(`${op} failed`), { status: 502, code: "DATABASE_ERROR", expose: true });
  }

  async insertJob({ ownerId, inputType = "prompt", inputText = null, sourceFileId = null, pageRange = null, settings, retryOf = null, attemptCount = 1 }) {
    this.#maybeFail("insert");
    if ([...this.rows.values()].some((r) => r.owner_id === ownerId && ACTIVE_STATUSES.includes(r.status))) {
      throw new ActiveJobExistsError();
    }
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      owner_id: ownerId,
      input_type: inputType,
      input_text: inputText,
      source_file_id: sourceFileId,
      page_range: pageRange,
      settings,
      status: "queued",
      stage: null,
      progress: 0,
      learning_plan: null,
      scene_json: null,
      mermaid_source: null,
      warnings: [],
      error_code: null,
      safe_error_message: null,
      model_id: null,
      prompt_version: null,
      usage: null,
      attempt_count: attemptCount,
      retry_of: retryOf,
      created_at: now,
      started_at: null,
      finished_at: null,
      updated_at: now,
    };
    this.rows.set(row.id, row);
    return structuredClone(row);
  }

  async getSourceFile({ ownerId, sourceFileId }) {
    if (!this.supabaseState) return null;
    const row = this.supabaseState.sourceFiles.get(sourceFileId);
    return row && row.owner_id === ownerId ? structuredClone(row) : null;
  }

  async getSourceFileForRunner({ sourceFileId, ownerId }) {
    return this.getSourceFile({ ownerId, sourceFileId });
  }

  async downloadSourceObject(objectPath) {
    const obj = this.supabaseState?.objects.get(`source-files/${objectPath}`);
    if (!obj) throw Object.assign(new Error("Missing source object"), { code: "SOURCE_NOT_FOUND" });
    return Buffer.from(obj.buffer);
  }

  async updateSourceExtraction(sourceFileId, ownerId, patch) {
    const row = this.supabaseState?.sourceFiles.get(sourceFileId);
    if (row && row.owner_id === ownerId) {
      Object.assign(row, structuredClone(patch), { updated_at: new Date().toISOString() });
    }
  }

  async getJob({ ownerId, jobId }) {
    this.#maybeFail("select");
    const row = this.rows.get(jobId);
    return row && row.owner_id === ownerId ? structuredClone(row) : null; // RLS-equivalent
  }

  getJobStatus(args) {
    return this.getJob(args);
  }

  async findActiveJob(ownerId) {
    const row = [...this.rows.values()].find((r) => r.owner_id === ownerId && ACTIVE_STATUSES.includes(r.status));
    return row ? structuredClone(row) : null;
  }

  async updateJob(jobId, patch, { expectStatus } = {}) {
    this.#maybeFail("update");
    const row = this.rows.get(jobId);
    if (!row || (expectStatus && !expectStatus.includes(row.status))) return null;
    const next = { ...row, ...structuredClone(patch), updated_at: new Date().toISOString() };
    if (next.status === "completed" && (!next.learning_plan || !next.scene_json || next.progress !== 100)) {
      throw new Error("generation_jobs_completed_has_result violated");
    }
    if (next.status === "failed" && (!next.error_code || !next.safe_error_message)) {
      throw new Error("generation_jobs_failed_has_error violated");
    }
    this.rows.set(jobId, next);
    return structuredClone(next);
  }

  async failInterruptedJobs({ code, message }) {
    let n = 0;
    for (const row of this.rows.values()) {
      if (!ACTIVE_STATUSES.includes(row.status)) continue;
      Object.assign(row, row.status === "cancelling" ? { status: "cancelled" } : { status: "failed", error_code: code, safe_error_message: message });
      n += 1;
    }
    return n;
  }

  /** Test helper: seed a row directly (bypasses rules, like a service-role write). */
  seed(row) {
    const full = { id: randomUUID(), input_type: "prompt", settings: {}, stage: null, progress: 0, warnings: [], attempt_count: 1, retry_of: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row };
    this.rows.set(full.id, full);
    return full;
  }
}

/** A promise you can resolve from the outside. */
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Controllable fake pipeline. By default the planner resolves immediately with
 * SAMPLE_PLAN. Set `gate` to a deferred() to hold the planner "in flight".
 */
export function createFakePipelineDeps(store = null) {
  const deps = {
    gate: null,
    plannerError: null,
    extractError: null,
    plan: SAMPLE_PLAN,
    failSections: new Set(),
    calls: [],
    tickMs: 5,
    async extractSource({ job }) {
      deps.calls.push({ op: "extract", inputType: job.input_type, sourceFileId: job.source_file_id, pageRange: job.page_range });
      if (deps.extractError) throw deps.extractError;
      const sf = await store?.getSourceFileForRunner({ sourceFileId: job.source_file_id, ownerId: job.owner_id });
      if (!sf) throw Object.assign(new Error("Missing source"), { code: "SOURCE_NOT_FOUND" });
      await store?.updateSourceExtraction(sf.id, job.owner_id, { extraction_status: "extracted", extracted_metadata: { processedPages: sf.page_count ?? 1 } });
      return {
        inputType: job.input_type,
        pageCount: sf.page_count ?? null,
        selectedPages: sf.page_count ? [1] : [],
        textContent: "[Page 1]\nExtracted sample source text",
        warnings: [],
        mediaParts: [],
      };
    },
    async planner(args) {
      deps.calls.push({ op: "planner", inputType: args.inputType, prompt: args.prompt, extractedSource: args.extractedSource, settings: args.settings, preferredVisualTypes: args.preferredVisualTypes });
      if (deps.gate) {
        await new Promise((resolve, reject) => {
          deps.gate.promise.then(resolve, reject);
          args.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { code: "CANCELLED" })), { once: true });
        });
      }
      if (deps.plannerError) throw deps.plannerError;
      return { plan: structuredClone(deps.plan), model: "gemini-test", promptVersion: "planner-test", repaired: false, latencyMs: 12, usageMetadata: { totalTokenCount: 321 } };
    },
    async compileSection(spec, { signal }) {
      deps.calls.push({ op: "compile", kind: spec.kind, signal: Boolean(signal) });
      if (deps.failSections.has(spec.kind)) throw Object.assign(new Error("Excalidraw CLI failed at C:\\secret\\path"), { code: "CLI_EXEC_FAILED" });
      const strategy = spec.kind === "comparison" ? "direct_scene" : "mermaid";
      return {
        strategy,
        kind: spec.kind,
        mermaidSource: strategy === "mermaid" ? "sequenceDiagram\n  Client->>Server: SYN" : null,
        scene: { elements: [box("a"), box("b")] },
      };
    },
  };
  return deps;
}

export function createTestGenerationStack({ config, logger, enabled = true, concurrency = 2, heartbeatMs = 50, generationOverrides = {}, supabaseState = null } = {}) {
  const store = new InMemoryJobStore(supabaseState);
  const bus = new JobEventBus();
  const queue = new InProcessQueue({ concurrency, logger });
  const pipelineDeps = createFakePipelineDeps(store);
  const cfg = { ...config, generation: { ...config.generation, enabled, ...generationOverrides } };
  const service = createGenerationService({ config: cfg, store, queue, bus, pipelineDeps, logger });
  return { service, store, bus, queue, pipelineDeps, heartbeatMs };
}
