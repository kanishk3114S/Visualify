import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LearningPlanSchema } from "../schemas/learningPlan.js";
import { compileDiagramSpecToScene } from "../adapters/sceneRouter.js";
import { renderScene } from "../renderer/cliRenderer.js";
import { loadWorkerEnv } from "../config/env.js";

loadWorkerEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const RENDERS_DIR = path.join(REPO_ROOT, "renders");

export const FIXTURE_PLANS = [
  {
    name: "tcp-handshake",
    plan: {
      schemaVersion: "1.0",
      title: "TCP Three-Way Handshake",
      summary: "How a client and server establish a reliable TCP session.",
      learningObjectives: ["Understand SYN, SYN-ACK, and ACK sequence"],
      sections: [
        {
          id: "tcp-seq",
          title: "Connection Establishment Sequence",
          visualType: "sequence",
          keyConcepts: ["Client", "Server", "SYN", "SYN-ACK", "ACK"],
          relationships: [
            { from: "Client", to: "Server", label: "SYN" },
            { from: "Server", to: "Client", label: "SYN-ACK" },
            { from: "Client", to: "Server", label: "ACK" },
          ],
          explanation: "TCP uses three control packets to synchronize initial sequence numbers.",
          sourceRefs: [],
          diagramSpec: {
            kind: "sequence",
            participants: [
              { id: "client", label: "Client" },
              { id: "server", label: "Server" },
            ],
            messages: [
              { from: "client", to: "server", label: "SYN (seq=x)" },
              { from: "server", to: "client", label: "SYN-ACK (seq=y, ack=x+1)" },
              { from: "client", to: "server", label: "ACK (ack=y+1)" },
            ],
          },
        },
      ],
      warnings: [],
    },
  },
  {
    name: "http-request-flow",
    plan: {
      schemaVersion: "1.0",
      title: "HTTP Request Flow",
      summary: "Lifecycle of an HTTP request through middleware and database.",
      learningObjectives: ["Trace request validation and response lifecycle"],
      sections: [
        {
          id: "http-flow",
          title: "Request Lifecycle",
          visualType: "flowchart",
          keyConcepts: ["Client", "Router", "Validation", "Handler", "Response"],
          relationships: [{ from: "Client", to: "Router", label: "GET /notes" }],
          explanation: "Requests pass through validation before reaching domain handlers.",
          sourceRefs: [],
          diagramSpec: {
            kind: "flowchart",
            direction: "TD",
            nodes: [
              { id: "client", label: "React SPA" },
              { id: "api", label: "Express Router" },
              { id: "valid", label: "Zod Valid?" },
              { id: "handler", label: "Controller" },
              { id: "err", label: "400 Bad Request" },
            ],
            edges: [
              { from: "client", to: "api", label: "HTTPS Request" },
              { from: "api", to: "valid" },
              { from: "valid", to: "handler", label: "Yes" },
              { from: "valid", to: "err", label: "No" },
            ],
          },
        },
      ],
      warnings: [],
    },
  },
  {
    name: "os-concepts-mindmap",
    plan: {
      schemaVersion: "1.0",
      title: "Operating System Core Concepts",
      summary: "Core responsibilities of an operating system kernel.",
      learningObjectives: ["Connect processes, memory, storage, and I/O"],
      sections: [
        {
          id: "os-map",
          title: "OS Architecture Map",
          visualType: "mindmap",
          keyConcepts: ["Kernel", "Processes", "Memory", "File Systems"],
          relationships: [{ from: "Operating Systems", to: "Process Management", label: "includes" }],
          explanation: "An OS coordinates CPU scheduling, virtual memory, and persistence.",
          sourceRefs: [],
          diagramSpec: {
            kind: "mindmap",
            root: { id: "os", label: "Operating Systems" },
            branches: [
              {
                id: "proc",
                label: "Process Management",
                children: [
                  { id: "sched", label: "CPU Scheduling" },
                  { id: "threads", label: "Threads & Locks" },
                ],
              },
              {
                id: "mem",
                label: "Memory Management",
                children: [
                  { id: "paging", label: "Virtual Paging" },
                  { id: "alloc", label: "Heap Allocation" },
                ],
              },
              {
                id: "io",
                label: "Storage & I/O",
                children: [
                  { id: "fs", label: "File Systems" },
                  { id: "drivers", label: "Device Drivers" },
                ],
              },
            ],
          },
        },
      ],
      warnings: [],
    },
  },
  {
    name: "sql-vs-nosql-comparison",
    plan: {
      schemaVersion: "1.0",
      title: "SQL vs NoSQL Databases",
      summary: "Side-by-side trade-offs between relational and non-relational databases.",
      learningObjectives: ["Compare schema, scaling, and consistency models"],
      sections: [
        {
          id: "db-compare",
          title: "SQL vs NoSQL",
          visualType: "comparison",
          keyConcepts: ["Relational", "Document", "ACID", "Sharding"],
          relationships: [{ from: "SQL", to: "NoSQL", label: "differs in schema" }],
          explanation: "SQL enforces normalized relations; NoSQL favors flexible denormalized documents.",
          sourceRefs: [],
          diagramSpec: {
            kind: "comparison",
            title: "SQL vs NoSQL Comparison",
            columns: [
              {
                id: "sql",
                title: "SQL (Relational)",
                items: [
                  { label: "Data Model", value: "Tables with fixed schema & foreign keys" },
                  { label: "Transactions", value: "Strong ACID guarantees across rows" },
                  { label: "Scaling", value: "Primarily vertical + read replicas" },
                ],
              },
              {
                id: "nosql",
                title: "NoSQL (Document / KV)",
                items: [
                  { label: "Data Model", value: "Flexible JSON documents or key-value" },
                  { label: "Transactions", value: "Eventual consistency or single-doc ACID" },
                  { label: "Scaling", value: "Horizontal sharding out of the box" },
                ],
              },
            ],
          },
        },
      ],
      warnings: [],
    },
  },
  {
    name: "timeline-evolution",
    plan: {
      schemaVersion: "1.0",
      title: "Web Architecture Evolution",
      summary: "Major milestones in web application architecture.",
      learningObjectives: ["Trace evolution from static pages to AI workspaces"],
      sections: [
        {
          id: "web-timeline",
          title: "Architecture Timeline",
          visualType: "timeline",
          keyConcepts: ["Static HTML", "AJAX", "SPA", "AI Workspaces"],
          relationships: [],
          explanation: "Web apps evolved from server-rendered HTML to interactive AI workspaces.",
          sourceRefs: [],
          diagramSpec: {
            kind: "timeline",
            title: "Web Architecture Evolution",
            events: [
              { id: "e1", period: "1995", label: "Static HTML Pages" },
              { id: "e2", period: "2005", label: "AJAX and Dynamic Web" },
              { id: "e3", period: "2015", label: "Single Page Applications" },
              { id: "e4", period: "2025", label: "AI-Assisted Workspaces" },
            ],
          },
        },
      ],
      warnings: [],
    },
  },
  {
    name: "er-data-model",
    plan: {
      schemaVersion: "1.0",
      title: "Notes Ownership Data Model",
      summary: "Entity relationship between users and visual notes.",
      learningObjectives: ["Understand one-to-many ownership in PostgreSQL"],
      sections: [
        {
          id: "notes-er",
          title: "User and Note Entities",
          visualType: "er_diagram",
          keyConcepts: ["User", "Note", "One-to-Many"],
          relationships: [{ from: "User", to: "Note", label: "owns" }],
          explanation: "Each user profile owns zero or more visual notes.",
          sourceRefs: [],
          diagramSpec: {
            kind: "er_diagram",
            entities: [
              { id: "user", name: "User", attributes: ["id", "email", "display_name"] },
              { id: "note", name: "Note", attributes: ["id", "title", "created_at"] },
            ],
            relations: [
              { from: "user", to: "note", cardinality: "one-to-many", label: "owns" },
            ],
          },
        },
      ],
      warnings: [],
    },
  },
  {
    name: "class-architecture",
    plan: {
      schemaVersion: "1.0",
      title: "Worker Pipeline Classes",
      summary: "Core planner and adapter classes in Visualify.",
      learningObjectives: ["Understand separation between AI planning and scene compilation"],
      sections: [
        {
          id: "worker-classes",
          title: "Planner and Adapter",
          visualType: "class_diagram",
          keyConcepts: ["LearningPlanner", "SceneAdapter"],
          relationships: [{ from: "LearningPlanner", to: "SceneAdapter", label: "feeds" }],
          explanation: "The planner emits a validated plan consumed by the deterministic adapter.",
          sourceRefs: [],
          diagramSpec: {
            kind: "class_diagram",
            classes: [
              {
                id: "planner",
                name: "LearningPlanner",
                attributes: ["modelId", "schemaVersion"],
                methods: ["generatePlan()"],
              },
              {
                id: "adapter",
                name: "SceneAdapter",
                attributes: ["strategy"],
                methods: ["compileScene()"],
              },
            ],
            relations: [
              { from: "planner", to: "adapter", type: "association", label: "feeds" },
            ],
          },
        },
      ],
      warnings: [],
    },
  },
];

async function run() {
  await fs.mkdir(RENDERS_DIR, { recursive: true });
  const results = [];

  for (const fixture of FIXTURE_PLANS) {
    const validated = LearningPlanSchema.parse(fixture.plan);
    const section = validated.sections[0];

    const compiled = await compileDiagramSpecToScene(section.diagramSpec);
    const png = await renderScene({ sceneJson: compiled.scene, format: "png" });
    const svg = await renderScene({ sceneJson: compiled.scene, format: "svg" });

    const sceneOut = path.join(RENDERS_DIR, `${fixture.name}.excalidraw`);
    const pngOut = path.join(RENDERS_DIR, `${fixture.name}.png`);
    const svgOut = path.join(RENDERS_DIR, `${fixture.name}.svg`);

    await fs.writeFile(sceneOut, JSON.stringify(compiled.scene, null, 2), "utf8");
    await fs.writeFile(pngOut, png.buffer);
    await fs.writeFile(svgOut, svg.buffer);

    results.push({
      fixture: fixture.name,
      strategy: compiled.strategy,
      kind: compiled.kind,
      elementCount: compiled.scene.elements.length,
      conversionLatencyMs: compiled.conversionLatencyMs,
      pngBytes: png.bytes,
      pngLatencyMs: png.latencyMs,
      svgBytes: svg.bytes,
      svgLatencyMs: svg.latencyMs,
    });
  }

  console.log(JSON.stringify({ status: "PASS", results }, null, 2));
}

run().catch((err) => {
  console.error("Local spike failed:", err);
  process.exitCode = 1;
});
