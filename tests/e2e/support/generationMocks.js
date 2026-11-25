/**
 * Contract-faithful mock of /api/v1/generations* for Playwright, matching the
 * Express API (envelope, status codes, SSE event names/payloads). The scene
 * for completed jobs is produced by the REAL worker adapters and composer, so
 * the workspace test loads genuine Excalidraw elements.
 */
import { buildComparisonScene, buildMindmapScene } from "../../../backend/worker/src/adapters/directSceneAdapter.js";
import { composeLessonScene } from "../../../backend/worker/src/adapters/sceneComposer.js";

export const PLAN = {
  schemaVersion: "1.0",
  title: "Databases at a glance",
  summary: "A map of database families and how SQL and NoSQL compare.",
  learningObjectives: ["Name the main database families", "Compare SQL and NoSQL trade-offs"],
  sections: [
    {
      id: "families",
      title: "Database families",
      visualType: "mindmap",
      keyConcepts: ["Relational", "Document", "Key-value"],
      relationships: [{ from: "Databases", to: "Relational", label: "includes" }],
      explanation: "Databases branch into relational systems and several NoSQL families.",
      sourceRefs: [],
      diagramSpec: {
        kind: "mindmap",
        root: { id: "root", label: "Databases" },
        branches: [
          { id: "rel", label: "Relational", children: [{ id: "pg", label: "Postgres" }] },
          { id: "doc", label: "Document", children: [{ id: "mongo", label: "MongoDB" }] },
        ],
      },
    },
    {
      id: "sql_vs_nosql",
      title: "SQL vs NoSQL",
      visualType: "comparison",
      keyConcepts: ["Schema", "Scaling"],
      relationships: [],
      explanation: "SQL favours fixed schemas and joins; NoSQL favours flexible schemas and horizontal scaling.",
      sourceRefs: [],
      diagramSpec: {
        kind: "comparison",
        title: "SQL vs NoSQL",
        columns: [
          { id: "sql", title: "SQL", items: [{ label: "Schema", value: "Fixed" }] },
          { id: "nosql", title: "NoSQL", items: [{ label: "Schema", value: "Flexible" }] },
        ],
      },
    },
  ],
  warnings: [],
};

export const SCENE = composeLessonScene([
  { sectionId: "families", title: "Database families", scene: buildMindmapScene(PLAN.sections[0].diagramSpec) },
  // title: null mirrors the pipeline, which skips a heading the diagram already shows.
  { sectionId: "sql_vs_nosql", title: null, scene: buildComparisonScene(PLAN.sections[1].diagramSpec) },
]);

const sse = (events) =>
  "retry: 3000\n\n" + events.map(([type, data], i) => `id: ${i + 1}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join("");

function jobDto(id, overrides = {}) {
  return {
    jobId: id,
    status: "queued",
    stage: null,
    progress: 0,
    inputType: "prompt",
    prompt: "Compare SQL and NoSQL databases",
    settings: { subject: "", audienceLevel: "undergraduate", detail: "standard", visualStyle: "hand_drawn_clean", preferredOutput: "auto" },
    safeError: null,
    learningPlan: null,
    sceneJson: null,
    mermaidSource: null,
    warnings: [],
    attemptCount: 1,
    retryOf: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

const completed = (id, extra = {}) => jobDto(id, { status: "completed", progress: 100, learningPlan: PLAN, sceneJson: SCENE, finishedAt: new Date().toISOString(), ...extra });

/**
 * scenario:
 *  - "complete": SSE runs through every stage to completed
 *  - "fail":     SSE ends with a failed event (safe error); retry then completes
 *  - "drop":     SSE endpoint errors -> client must fall back to polling GET
 *  - "hold":     SSE sends a snapshot then closes; job stays "planning" until cancelled
 */
export function createGenerationMock({ scenario = "complete", activeJobId = null, warnings = [] } = {}) {
  const jobs = new Map();
  const mock = { jobs, scenario, posted: [], polls: 0, cancelled: [] };
  let counter = 0;
  const newId = () => `7c9e6679-7425-40de-944b-e07fc1f9${String(++counter).padStart(4, "0")}`;

  mock.handle = ({ route, req, url, json, cors, ok, fail }) => {
    const parts = url.pathname.split("/").filter(Boolean); // api v1 generations :id action
    const id = parts[3];
    const action = parts[4];
    const method = req.method();

    if (!id && method === "POST") {
      const body = req.postDataJSON();
      mock.posted.push(body);
      if (activeJobId) {
        return json(409, fail("ACTIVE_JOB_EXISTS", "You already have a visual being generated.", { activeJobId }));
      }
      const jobId = newId();
      jobs.set(jobId, jobDto(jobId, { prompt: body.prompt, settings: body.settings }));
      return json(202, ok({ jobId, status: "queued" }));
    }

    if (!jobs.has(id)) return json(404, fail("NOT_FOUND", "Generation not found."));

    if (!action && method === "GET") {
      if (mock.scenario === "drop" && jobs.get(id).status !== "completed") {
        mock.polls += 1;
        // First poll: still planning; afterwards: completed.
        if (mock.polls >= 2) jobs.set(id, completed(id, { warnings }));
        else jobs.set(id, { ...jobs.get(id), status: "planning", stage: "planning", progress: 30 });
      }
      return json(200, ok({ job: jobs.get(id) }));
    }

    if (action === "events" && method === "GET") {
      const headers = { ...cors, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" };
      if (mock.scenario === "drop") return json(503, fail("SERVICE_UNAVAILABLE", "Temporarily unavailable."));
      if (mock.scenario === "hold") {
        jobs.set(id, { ...jobs.get(id), status: "planning", stage: "planning", progress: 25 });
        return route.fulfill({ status: 200, headers, body: sse([["snapshot", { status: "planning", stage: "planning", progress: 25, safeError: null }]]) });
      }
      if (mock.scenario === "fail") {
        const error = { code: "AI_BUSY", message: "The AI service is busy right now. Please try again in a few minutes." };
        jobs.set(id, jobDto(id, { status: "failed", progress: 12, safeError: error }));
        mock.scenario = "complete"; // a retry will succeed
        return route.fulfill({
          status: 200,
          headers,
          body: sse([
            ["snapshot", { status: "queued", stage: null, progress: 0, safeError: null }],
            ["stage", { status: "planning", stage: "planning", progress: 12 }],
            ["failed", { status: "failed", progress: 12, error }],
          ]),
        });
      }
      jobs.set(id, completed(id, { warnings }));
      return route.fulfill({
        status: 200,
        headers,
        body: sse([
          ["snapshot", { status: "queued", stage: null, progress: 0, safeError: null }],
          ["stage", { status: "validating", stage: "validating", progress: 5 }],
          ["stage", { status: "planning", stage: "planning", progress: 12 }],
          ["progress", { progress: 40 }],
          ["stage", { status: "composing", stage: "composing", progress: 62 }],
          ["stage", { status: "persisting", stage: "persisting", progress: 92 }],
          ["completed", { status: "completed", progress: 100 }],
        ]),
      });
    }

    if (action === "cancel" && method === "POST") {
      mock.cancelled.push(id);
      jobs.set(id, { ...jobs.get(id), status: "cancelled", stage: null });
      return json(200, ok({ jobId: id, status: "cancelled" }));
    }

    if (action === "retry" && method === "POST") {
      const jobId = newId();
      jobs.set(jobId, jobDto(jobId, { attemptCount: 2, retryOf: id }));
      mock.scenario = "complete";
      return json(202, ok({ jobId, status: "queued", retryOf: id }));
    }

    return json(404, fail("NOT_FOUND", "Generation not found."));
  };
  return mock;
}
