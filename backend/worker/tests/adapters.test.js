import { describe, it, expect, vi } from "vitest";
import {
  buildMermaidSource,
  sanitizeMermaidLabel,
} from "../src/adapters/mermaidAdapter.js";
import {
  buildComparisonScene,
  buildMindmapScene,
} from "../src/adapters/directSceneAdapter.js";
import {
  ADAPTER_ROUTING_TABLE,
  compileDiagramSpecToScene,
} from "../src/adapters/sceneRouter.js";
import { validateExcalidrawScene } from "../src/schemas/excalidrawScene.js";

describe("Adapters & Scene Validation", () => {
  it("maps diagram types to expected adapter strategies", () => {
    expect(ADAPTER_ROUTING_TABLE.flowchart).toBe("mermaid");
    expect(ADAPTER_ROUTING_TABLE.sequence).toBe("mermaid");
    expect(ADAPTER_ROUTING_TABLE.timeline).toBe("mermaid");
    expect(ADAPTER_ROUTING_TABLE.er_diagram).toBe("mermaid");
    expect(ADAPTER_ROUTING_TABLE.class_diagram).toBe("mermaid");
    expect(ADAPTER_ROUTING_TABLE.mindmap).toBe("direct_scene");
    expect(ADAPTER_ROUTING_TABLE.comparison).toBe("direct_scene");
  });

  it("sanitizes unsafe Mermaid characters and directives in labels", () => {
    const dirty = 'User "Admin"\n%%{init: evil}%%\n[Step] -> (Next)';
    const clean = sanitizeMermaidLabel(dirty);
    expect(clean).not.toContain('"');
    expect(clean).not.toContain("\n");
    expect(clean).not.toContain("[");
    expect(clean).not.toContain("{");
  });

  it("generates deterministic Mermaid source for flowchart and sequence specs", () => {
    const flow = buildMermaidSource({
      kind: "flowchart",
      direction: "LR",
      nodes: [
        { id: "a", label: "Start" },
        { id: "b", label: "End" },
      ],
      edges: [{ from: "a", to: "b", label: "go" }],
    });
    expect(flow).toContain("flowchart LR");
    expect(flow).toContain('n_a(["Start"])');
    expect(flow).toContain('n_b(["End"])');
    expect(flow).toContain('n_a -->|"go"| n_b');
    expect(flow).toContain("classDef core");

    const seq = buildMermaidSource({
      kind: "sequence",
      participants: [
        { id: "c", label: "Client" },
        { id: "s", label: "Server" },
      ],
      messages: [{ from: "c", to: "s", label: "SYN" }],
    });
    expect(seq).toContain("sequenceDiagram");
    expect(seq).toContain("n_c->>n_s: SYN");
  });

  it("builds valid, unique-ID mindmap scenes with consistent arrow bindings", () => {
    const scene = buildMindmapScene({
      kind: "mindmap",
      root: { id: "os", label: "Operating Systems" },
      branches: [
        {
          id: "proc",
          label: "Process Management",
          children: [
            { id: "sched", label: "Scheduling" },
            { id: "threads", label: "Threads" },
          ],
        },
        {
          id: "mem",
          label: "Memory Management",
          children: [{ id: "paging", label: "Virtual Paging" }],
        },
      ],
    });

    const validation = validateExcalidrawScene(scene);
    expect(validation.valid, validation.errors.join("; ")).toBe(true);
    const ids = scene.elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(scene.elements.some((e) => e.type === "arrow")).toBe(true);
  });

  it("builds valid aligned comparison board scenes", () => {
    const scene = buildComparisonScene({
      kind: "comparison",
      title: "SQL vs NoSQL",
      columns: [
        {
          id: "sql",
          title: "SQL",
          items: [
            { label: "Schema", value: "Fixed relational tables" },
            { label: "ACID", value: "Full multi-row transactions" },
          ],
        },
        {
          id: "nosql",
          title: "NoSQL",
          items: [
            { label: "Schema", value: "Flexible document collections" },
            { label: "Scale", value: "Horizontal sharding" },
          ],
        },
      ],
    });

    const validation = validateExcalidrawScene(scene);
    expect(validation.valid, validation.errors.join("; ")).toBe(true);
    const rects = scene.elements.filter((e) => e.type === "rectangle");
    // 2 headers + 4 item cards + 1 Key Takeaway callout banner
    expect(rects.length).toBe(7);
    expect(scene.elements.some((e) => e.type === "ellipse")).toBe(true);
    expect(scene.elements.some((e) => e.type === "text" && e.text.includes("Key Takeaway"))).toBe(true);

    // Every box label is container-bound so dragging keeps text attached
    const boundTexts = scene.elements.filter((e) => e.type === "text" && e.containerId);
    expect(boundTexts.length).toBeGreaterThanOrEqual(7);
  });

  it("threads visualStyle presets into direct adapters and styleConvertedScene", async () => {
    const { styleConvertedScene } = await import("../src/adapters/diagramTheme.js");
    const editorial = buildMindmapScene(
      {
        kind: "mindmap",
        root: { id: "r", label: "Root" },
        branches: [
          { id: "b1", label: "One", children: [{ id: "c1", label: "Leaf" }] },
          { id: "b2", label: "Two", children: [{ id: "c2", label: "Leaf 2" }] },
        ],
      },
      { visualStyle: "editorial_color" }
    );
    const rootRect = editorial.elements.find((e) => e.id.startsWith("mm-root"));
    expect(rootRect.roughness).toBe(0);
    expect(rootRect.boundElements.some((b) => b.type === "text")).toBe(true);
    expect(rootRect.boundElements.some((b) => b.type === "arrow")).toBe(true);

    const minimal = styleConvertedScene(
      {
        elements: [
          { id: "r1", type: "rectangle", x: 0, y: 0, width: 100, height: 50, backgroundColor: "#ffffff", strokeColor: "#000000", boundElements: [{ id: "t1", type: "text" }] },
          { id: "t1", type: "text", x: 10, y: 10, width: 80, height: 20, text: "Node", containerId: "r1", strokeColor: "#000000" },
        ],
      },
      { visualStyle: "minimal", kind: "flowchart" }
    );
    expect(minimal.elements[0].roughness).toBe(0);
    expect(minimal.elements[0].fillStyle).toBe("solid");
    expect(minimal.elements[1].strokeColor).toBe("#0f172a");
  });

  it("rejects scenes with empty elements, duplicate IDs, or dangling arrow bindings", () => {
    expect(validateExcalidrawScene({ elements: [] }).valid).toBe(false);
    expect(
      validateExcalidrawScene({
        elements: [
          { id: "dup", type: "rectangle", x: 0, y: 0, width: 100, height: 50 },
          { id: "dup", type: "rectangle", x: 200, y: 0, width: 100, height: 50 },
        ],
      }).valid
    ).toBe(false);
    expect(
      validateExcalidrawScene({
        elements: [
          {
            id: "arr-1",
            type: "arrow",
            x: 0,
            y: 0,
            width: 50,
            height: 0,
            points: [
              [0, 0],
              [50, 0],
            ],
            startBinding: { elementId: "missing-target", focus: 0, gap: 5 },
          },
        ],
      }).valid
    ).toBe(false);
  });

  it("routes direct_scene specs without invoking Mermaid converter", async () => {
    const mockMermaidConverter = vi.fn();
    const res = await compileDiagramSpecToScene(
      {
        kind: "comparison",
        title: "REST vs GraphQL",
        columns: [
          { id: "rest", title: "REST", items: [{ label: "Endpoints", value: "Multiple" }] },
          { id: "gql", title: "GraphQL", items: [{ label: "Endpoints", value: "Single" }] },
        ],
      },
      { mermaidConverter: mockMermaidConverter }
    );

    expect(res.strategy).toBe("direct_scene");
    expect(mockMermaidConverter).not.toHaveBeenCalled();
    expect(res.scene.elements.length).toBeGreaterThan(0);
  });

  it("produces deterministic identical scene output for identical mindmap and comparison inputs", () => {
    const mmSpec = {
      kind: "mindmap",
      root: { id: "root", label: "Databases" },
      branches: [
        { id: "rel", label: "Relational", children: [{ id: "pg", label: "Postgres" }] },
        { id: "doc", label: "Document", children: [{ id: "mongo", label: "MongoDB" }] },
      ],
    };
    expect(buildMindmapScene(mmSpec)).toEqual(buildMindmapScene(mmSpec));

    const cmpSpec = {
      kind: "comparison",
      title: "A vs B",
      columns: [
        { id: "a", title: "Option A", items: [{ label: "Speed", value: "Fast" }] },
        { id: "b", title: "Option B", items: [{ label: "Speed", value: "Moderate" }] },
      ],
    };
    expect(buildComparisonScene(cmpSpec)).toEqual(buildComparisonScene(cmpSpec));
  });

  it("generates clean Mermaid syntax for timeline, er_diagram, and class_diagram", () => {
    const tl = buildMermaidSource({
      kind: "timeline",
      title: "History",
      events: [
        { id: "e1", period: "2000", label: "Start" },
        { id: "e2", period: "2020", label: "Scale" },
      ],
    });
    expect(tl).toContain("timeline");
    expect(tl).toContain("2000 : Start");

    const er = buildMermaidSource({
      kind: "er_diagram",
      entities: [
        { id: "u", name: "User", attributes: ["id", "email"] },
        { id: "n", name: "Note", attributes: ["id"] },
      ],
      relations: [{ from: "u", to: "n", cardinality: "one-to-many", label: "owns" }],
    });
    expect(er).toContain("USER {");
    expect(er).toContain("string email");
    expect(er).not.toContain("N_USER");

    const cls = buildMermaidSource({
      kind: "class_diagram",
      classes: [
        { id: "p", name: "LearningPlanner", attributes: ["modelId"], methods: ["generatePlan()"] },
        { id: "a", name: "SceneAdapter", attributes: ["kind"], methods: ["compile()"] },
      ],
      relations: [{ from: "p", to: "a", type: "association", label: "feeds" }],
    });
    expect(cls).toContain('class n_p["LearningPlanner"]');
    expect(cls).toContain("+generatePlan()");
  });
});
