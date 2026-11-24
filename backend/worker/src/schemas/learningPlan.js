import { z } from "zod";

export const SUPPORTED_VISUAL_TYPES = [
  "flowchart",
  "sequence",
  "mindmap",
  "comparison",
  "timeline",
  "er_diagram",
  "class_diagram",
];

const IdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, "IDs must contain only letters, digits, hyphens, or underscores");

const ShortLabelSchema = z.string().trim().min(1).max(120);

const FlowchartSpecSchema = z
  .object({
    kind: z.enum(["flowchart"]),
    direction: z.enum(["TD", "LR"]).default("TD"),
    nodes: z
      .array(
        z
          .object({
            id: IdSchema,
            label: ShortLabelSchema,
          })
          .strict()
      )
      .min(2)
      .max(30),
    edges: z
      .array(
        z
          .object({
            from: IdSchema,
            to: IdSchema,
            label: z.string().trim().max(80).optional(),
          })
          .strict()
      )
      .min(1)
      .max(45),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const nodeIds = new Set();
    for (let i = 0; i < spec.nodes.length; i++) {
      const id = spec.nodes[i].id;
      if (nodeIds.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", i, "id"],
          message: `Duplicate flowchart node id: ${id}`,
        });
      }
      nodeIds.add(id);
    }
    for (let i = 0; i < spec.edges.length; i++) {
      const edge = spec.edges[i];
      if (!nodeIds.has(edge.from)) {
        ctx.addIssue({
          code: "custom",
          path: ["edges", i, "from"],
          message: `Flowchart edge references unknown node: ${edge.from}`,
        });
      }
      if (!nodeIds.has(edge.to)) {
        ctx.addIssue({
          code: "custom",
          path: ["edges", i, "to"],
          message: `Flowchart edge references unknown node: ${edge.to}`,
        });
      }
    }
  });

const SequenceSpecSchema = z
  .object({
    kind: z.enum(["sequence"]),
    participants: z
      .array(
        z
          .object({
            id: IdSchema,
            label: ShortLabelSchema,
          })
          .strict()
      )
      .min(2)
      .max(10),
    messages: z
      .array(
        z
          .object({
            from: IdSchema,
            to: IdSchema,
            label: ShortLabelSchema,
          })
          .strict()
      )
      .min(1)
      .max(30),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const participantIds = new Set();
    for (let i = 0; i < spec.participants.length; i++) {
      const id = spec.participants[i].id;
      if (participantIds.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["participants", i, "id"],
          message: `Duplicate sequence participant id: ${id}`,
        });
      }
      participantIds.add(id);
    }
    for (let i = 0; i < spec.messages.length; i++) {
      const msg = spec.messages[i];
      if (!participantIds.has(msg.from)) {
        ctx.addIssue({
          code: "custom",
          path: ["messages", i, "from"],
          message: `Sequence message references unknown participant: ${msg.from}`,
        });
      }
      if (!participantIds.has(msg.to)) {
        ctx.addIssue({
          code: "custom",
          path: ["messages", i, "to"],
          message: `Sequence message references unknown participant: ${msg.to}`,
        });
      }
    }
  });

const MindmapSpecSchema = z
  .object({
    kind: z.enum(["mindmap"]),
    root: z
      .object({
        id: IdSchema,
        label: ShortLabelSchema,
      })
      .strict(),
    branches: z
      .array(
        z
          .object({
            id: IdSchema,
            label: ShortLabelSchema,
            children: z
              .array(
                z
                  .object({
                    id: IdSchema,
                    label: ShortLabelSchema,
                  })
                  .strict()
              )
              .min(1)
              .max(6),
          })
          .strict()
      )
      .min(2)
      .max(8),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const seen = new Set([spec.root.id]);
    for (let b = 0; b < spec.branches.length; b++) {
      const branch = spec.branches[b];
      if (seen.has(branch.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["branches", b, "id"],
          message: `Duplicate mindmap id: ${branch.id}`,
        });
      }
      seen.add(branch.id);
      for (let c = 0; c < branch.children.length; c++) {
        const child = branch.children[c];
        if (seen.has(child.id)) {
          ctx.addIssue({
            code: "custom",
            path: ["branches", b, "children", c, "id"],
            message: `Duplicate mindmap id: ${child.id}`,
          });
        }
        seen.add(child.id);
      }
    }
  });

const ComparisonSpecSchema = z
  .object({
    kind: z.enum(["comparison"]),
    title: ShortLabelSchema,
    columns: z
      .array(
        z
          .object({
            id: IdSchema,
            title: ShortLabelSchema,
            items: z
              .array(
                z
                  .object({
                    label: z.string().trim().min(1).max(80),
                    value: z.string().trim().min(1).max(160),
                  })
                  .strict()
              )
              .min(1)
              .max(10),
          })
          .strict()
      )
      .min(2)
      .max(4),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const seen = new Set();
    for (let i = 0; i < spec.columns.length; i++) {
      const id = spec.columns[i].id;
      if (seen.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["columns", i, "id"],
          message: `Duplicate comparison column id: ${id}`,
        });
      }
      seen.add(id);
    }
  });

const TimelineSpecSchema = z
  .object({
    kind: z.enum(["timeline"]),
    title: ShortLabelSchema,
    events: z
      .array(
        z
          .object({
            id: IdSchema,
            period: z.string().trim().min(1).max(60),
            label: ShortLabelSchema,
          })
          .strict()
      )
      .min(2)
      .max(15),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const seen = new Set();
    for (let i = 0; i < spec.events.length; i++) {
      const id = spec.events[i].id;
      if (seen.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["events", i, "id"],
          message: `Duplicate timeline event id: ${id}`,
        });
      }
      seen.add(id);
    }
  });

const ErDiagramSpecSchema = z
  .object({
    kind: z.enum(["er_diagram"]),
    entities: z
      .array(
        z
          .object({
            id: IdSchema,
            name: ShortLabelSchema,
            attributes: z.array(z.string().trim().min(1).max(80)).max(12),
          })
          .strict()
      )
      .min(2)
      .max(12),
    relations: z
      .array(
        z
          .object({
            from: IdSchema,
            to: IdSchema,
            cardinality: z.enum(["one-to-one", "one-to-many", "many-to-many"]),
            label: z.string().trim().min(1).max(60),
          })
          .strict()
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const entityIds = new Set();
    for (let i = 0; i < spec.entities.length; i++) {
      const id = spec.entities[i].id;
      if (entityIds.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["entities", i, "id"],
          message: `Duplicate ER entity id: ${id}`,
        });
      }
      entityIds.add(id);
    }
    for (let i = 0; i < spec.relations.length; i++) {
      const rel = spec.relations[i];
      if (!entityIds.has(rel.from)) {
        ctx.addIssue({
          code: "custom",
          path: ["relations", i, "from"],
          message: `ER relation references unknown entity: ${rel.from}`,
        });
      }
      if (!entityIds.has(rel.to)) {
        ctx.addIssue({
          code: "custom",
          path: ["relations", i, "to"],
          message: `ER relation references unknown entity: ${rel.to}`,
        });
      }
    }
  });

const ClassDiagramSpecSchema = z
  .object({
    kind: z.enum(["class_diagram"]),
    classes: z
      .array(
        z
          .object({
            id: IdSchema,
            name: ShortLabelSchema,
            attributes: z.array(z.string().trim().min(1).max(80)).max(10),
            methods: z.array(z.string().trim().min(1).max(80)).max(10),
          })
          .strict()
      )
      .min(2)
      .max(12),
    relations: z
      .array(
        z
          .object({
            from: IdSchema,
            to: IdSchema,
            type: z.enum(["inheritance", "composition", "aggregation", "association"]),
            label: z.string().trim().max(60).optional(),
          })
          .strict()
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const classIds = new Set();
    for (let i = 0; i < spec.classes.length; i++) {
      const id = spec.classes[i].id;
      if (classIds.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["classes", i, "id"],
          message: `Duplicate class id: ${id}`,
        });
      }
      classIds.add(id);
    }
    for (let i = 0; i < spec.relations.length; i++) {
      const rel = spec.relations[i];
      if (!classIds.has(rel.from)) {
        ctx.addIssue({
          code: "custom",
          path: ["relations", i, "from"],
          message: `Class relation references unknown class: ${rel.from}`,
        });
      }
      if (!classIds.has(rel.to)) {
        ctx.addIssue({
          code: "custom",
          path: ["relations", i, "to"],
          message: `Class relation references unknown class: ${rel.to}`,
        });
      }
    }
  });

export const DiagramSpecSchema = z.discriminatedUnion("kind", [
  FlowchartSpecSchema,
  SequenceSpecSchema,
  MindmapSpecSchema,
  ComparisonSpecSchema,
  TimelineSpecSchema,
  ErDiagramSpecSchema,
  ClassDiagramSpecSchema,
]);

export const LearningPlanSectionSchema = z
  .object({
    id: IdSchema,
    title: z.string().trim().min(1).max(160),
    visualType: z.enum(SUPPORTED_VISUAL_TYPES),
    keyConcepts: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
    relationships: z
      .array(
        z
          .object({
            from: z.string().trim().min(1).max(120),
            to: z.string().trim().min(1).max(120),
            label: z.string().trim().min(1).max(120),
          })
          .strict()
      )
      .max(30),
    explanation: z.string().trim().min(1).max(2000),
    sourceRefs: z
      .array(
        z
          .object({
            page: z.number().int().positive().optional(),
            snippet: z.string().trim().min(1).max(500),
          })
          .strict()
      )
      .max(20)
      .default([]),
    diagramSpec: DiagramSpecSchema,
  })
  .strict()
  .superRefine((section, ctx) => {
    if (section.visualType !== section.diagramSpec.kind) {
      ctx.addIssue({
        code: "custom",
        path: ["diagramSpec", "kind"],
        message: `visualType '${section.visualType}' does not match diagramSpec.kind '${section.diagramSpec.kind}'`,
      });
    }
  });

export const LearningPlanSchema = z
  .object({
    schemaVersion: z.enum(["1.0"]),
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(800),
    learningObjectives: z.array(z.string().trim().min(1).max(240)).min(1).max(8),
    sections: z.array(LearningPlanSectionSchema).min(1).max(8),
    warnings: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const sectionIds = new Set();
    for (let i = 0; i < plan.sections.length; i++) {
      const id = plan.sections[i].id;
      if (sectionIds.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["sections", i, "id"],
          message: `Duplicate section id: ${id}`,
        });
      }
      sectionIds.add(id);
    }
  });

/**
 * Strips JSON Schema keywords that are unsupported by Gemini or inflate its
 * finite-state grammar compiler (e.g. minItems/maxItems inside large unions).
 * Runtime Zod validation (LearningPlanSchema) remains strictly enforced on the server.
 */
function sanitizeForGemini(node) {
  if (Array.isArray(node)) {
    return node.map(sanitizeForGemini);
  }
  if (!node || typeof node !== "object") {
    return node;
  }

  const DISALLOWED_KEYS = new Set([
    "$schema",
    "minLength",
    "maxLength",
    "pattern",
    "minItems",
    "maxItems",
    "additionalProperties",
    "default",
  ]);
  const out = {};

  for (const [key, value] of Object.entries(node)) {
    if (DISALLOWED_KEYS.has(key)) continue;
    if (key === "const") {
      out.enum = [value];
      continue;
    }
    out[key] = sanitizeForGemini(value);
  }
  return out;
}

export function getLearningPlanGeminiJsonSchema() {
  const raw = z.toJSONSchema(LearningPlanSchema);
  return sanitizeForGemini(raw);
}
