import { describe, it, expect } from "vitest";
import {
  LearningPlanSchema,
  getLearningPlanGeminiJsonSchema,
} from "../src/schemas/learningPlan.js";

function makeValidPlan(overrides = {}) {
  return {
    schemaVersion: "1.0",
    title: "TCP Three-Way Handshake",
    summary: "How TCP establishes a connection.",
    learningObjectives: ["Identify SYN, SYN-ACK, and ACK"],
    sections: [
      {
        id: "tcp-seq",
        title: "Handshake Sequence",
        visualType: "sequence",
        keyConcepts: ["Client", "Server", "SYN", "SYN-ACK", "ACK"],
        relationships: [{ from: "Client", to: "Server", label: "SYN" }],
        explanation: "Client initiates with SYN, server replies SYN-ACK, client completes ACK.",
        sourceRefs: [],
        diagramSpec: {
          kind: "sequence",
          participants: [
            { id: "client", label: "Client" },
            { id: "server", label: "Server" },
          ],
          messages: [{ from: "client", to: "server", label: "SYN" }],
        },
      },
    ],
    warnings: [],
    ...overrides,
  };
}

describe("LearningPlanSchema", () => {
  it("accepts a valid learning plan across supported diagram types", () => {
    const plan = makeValidPlan();
    const res = LearningPlanSchema.safeParse(plan);
    expect(res.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const plan = makeValidPlan();
    delete plan.title;
    const res = LearningPlanSchema.safeParse(plan);
    expect(res.success).toBe(false);
  });

  it("rejects unsupported visualType", () => {
    const plan = makeValidPlan();
    plan.sections[0].visualType = "pie_chart";
    const res = LearningPlanSchema.safeParse(plan);
    expect(res.success).toBe(false);
  });

  it("rejects duplicate section IDs", () => {
    const plan = makeValidPlan();
    plan.sections.push(structuredClone(plan.sections[0]));
    const res = LearningPlanSchema.safeParse(plan);
    expect(res.success).toBe(false);
    expect(res.error.issues.some((i) => i.message.includes("Duplicate section id"))).toBe(true);
  });

  it("rejects mismatched visualType and diagramSpec.kind", () => {
    const plan = makeValidPlan();
    plan.sections[0].visualType = "flowchart";
    const res = LearningPlanSchema.safeParse(plan);
    expect(res.success).toBe(false);
    expect(res.error.issues.some((i) => i.message.includes("does not match diagramSpec.kind"))).toBe(true);
  });

  it("rejects flowchart edges referencing non-existent nodes", () => {
    const plan = makeValidPlan({
      sections: [
        {
          id: "flow-1",
          title: "Flow",
          visualType: "flowchart",
          keyConcepts: ["A", "B"],
          relationships: [],
          explanation: "Flow explanation.",
          sourceRefs: [],
          diagramSpec: {
            kind: "flowchart",
            direction: "TD",
            nodes: [
              { id: "a", label: "Step A" },
              { id: "b", label: "Step B" },
            ],
            edges: [{ from: "a", to: "missing-node" }],
          },
        },
      ],
    });
    const res = LearningPlanSchema.safeParse(plan);
    expect(res.success).toBe(false);
    expect(res.error.issues.some((i) => i.message.includes("unknown node"))).toBe(true);
  });

  it("rejects excessive flowchart node counts (> 30)", () => {
    const nodes = Array.from({ length: 31 }, (_, i) => ({
      id: `n-${i}`,
      label: `Node ${i}`,
    }));
    const plan = makeValidPlan({
      sections: [
        {
          id: "big-flow",
          title: "Too Large",
          visualType: "flowchart",
          keyConcepts: ["Complexity"],
          relationships: [],
          explanation: "Exceeds max budget.",
          sourceRefs: [],
          diagramSpec: {
            kind: "flowchart",
            direction: "TD",
            nodes,
            edges: [{ from: "n-0", to: "n-1" }],
          },
        },
      ],
    });
    const res = LearningPlanSchema.safeParse(plan);
    expect(res.success).toBe(false);
  });

  it("produces a Gemini-compatible JSON schema without unsupported keywords", () => {
    const jsonSchema = getLearningPlanGeminiJsonSchema();
    const serialized = JSON.stringify(jsonSchema);
    expect(serialized).not.toContain('"$schema"');
    expect(serialized).not.toContain('"minLength"');
    expect(serialized).not.toContain('"maxLength"');
    expect(serialized).not.toContain('"pattern"');
    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.required).toContain("sections");
  });

  it("rejects empty arrays, unexpected null values, and malformed nested objects", () => {
    expect(LearningPlanSchema.safeParse(makeValidPlan({ learningObjectives: [] })).success).toBe(
      false
    );
    expect(LearningPlanSchema.safeParse(makeValidPlan({ sections: [] })).success).toBe(false);
    expect(LearningPlanSchema.safeParse(makeValidPlan({ title: null })).success).toBe(false);

    const nullSpec = makeValidPlan();
    nullSpec.sections[0].diagramSpec = null;
    expect(LearningPlanSchema.safeParse(nullSpec).success).toBe(false);

    const malformedRel = makeValidPlan();
    malformedRel.sections[0].relationships = [{ from: "", to: "Server", label: "SYN" }];
    expect(LearningPlanSchema.safeParse(malformedRel).success).toBe(false);
  });

  it("validates timeline, er_diagram, and class_diagram specs and rejects dangling references", () => {
    const timelinePlan = makeValidPlan({
      sections: [
        {
          id: "tl-1",
          title: "Timeline",
          visualType: "timeline",
          keyConcepts: ["1995", "2025"],
          relationships: [],
          explanation: "Evolution over time.",
          sourceRefs: [],
          diagramSpec: {
            kind: "timeline",
            title: "Web Evolution",
            events: [
              { id: "e1", period: "1995", label: "HTML" },
              { id: "e2", period: "2025", label: "AI Apps" },
            ],
          },
        },
      ],
    });
    expect(LearningPlanSchema.safeParse(timelinePlan).success).toBe(true);

    const badErPlan = makeValidPlan({
      sections: [
        {
          id: "er-1",
          title: "ER",
          visualType: "er_diagram",
          keyConcepts: ["User", "Note"],
          relationships: [],
          explanation: "ER relations.",
          sourceRefs: [],
          diagramSpec: {
            kind: "er_diagram",
            entities: [
              { id: "user", name: "User", attributes: ["id"] },
              { id: "note", name: "Note", attributes: ["id"] },
            ],
            relations: [{ from: "user", to: "unknown", cardinality: "one-to-many", label: "owns" }],
          },
        },
      ],
    });
    expect(LearningPlanSchema.safeParse(badErPlan).success).toBe(false);

    const validClassPlan = makeValidPlan({
      sections: [
        {
          id: "cls-1",
          title: "Classes",
          visualType: "class_diagram",
          keyConcepts: ["A", "B"],
          relationships: [],
          explanation: "Class structure.",
          sourceRefs: [],
          diagramSpec: {
            kind: "class_diagram",
            classes: [
              { id: "a", name: "Planner", attributes: ["model"], methods: ["plan()"] },
              { id: "b", name: "Adapter", attributes: ["strategy"], methods: ["compile()"] },
            ],
            relations: [{ from: "a", to: "b", type: "association", label: "feeds" }],
          },
        },
      ],
    });
    expect(LearningPlanSchema.safeParse(validClassPlan).success).toBe(true);
  });
});
