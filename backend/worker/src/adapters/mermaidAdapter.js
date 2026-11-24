/**
 * Escapes untrusted label text so it cannot break Mermaid syntax or inject directives.
 */
export function sanitizeMermaidLabel(raw) {
  return String(raw ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/["`#;]/g, "'")
    .replace(/[[\]{}()<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * Sanitizes Mermaid node/participant identifiers to safe alphanumeric/underscore tokens.
 */
export function sanitizeMermaidId(raw) {
  const cleaned = String(raw ?? "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^_+/, "");
  return cleaned ? `n_${cleaned}` : "n_item";
}

/**
 * Produces a clean Mermaid identifier for ER entities/attributes and class names
 * without noisy "n_" prefixes when the token already starts with a letter.
 */
function cleanIdentifierToken(raw, fallback = "item") {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!cleaned) return fallback;
  return /^[a-zA-Z]/.test(cleaned) ? cleaned : `${fallback}_${cleaned}`;
}

function sanitizeMethodSignature(raw) {
  const base = String(raw ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/["`#;{}[\]<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (!base) return "method()";
  return base.includes("(") ? base : `${base}()`;
}

/**
 * Deterministically builds Mermaid source text from a validated diagramSpec.
 */
export function buildMermaidSource(diagramSpec) {
  if (!diagramSpec || typeof diagramSpec !== "object") {
    throw new Error("diagramSpec is required");
  }

  switch (diagramSpec.kind) {
    case "flowchart": {
      const direction = diagramSpec.direction === "LR" ? "LR" : "TD";
      const lines = [`flowchart ${direction}`];
      const idMap = new Map();

      for (const node of diagramSpec.nodes) {
        const safeId = sanitizeMermaidId(node.id);
        idMap.set(node.id, safeId);
        const label = sanitizeMermaidLabel(node.label);
        lines.push(`  ${safeId}["${label}"]`);
      }

      for (const edge of diagramSpec.edges) {
        const fromId = idMap.get(edge.from) || sanitizeMermaidId(edge.from);
        const toId = idMap.get(edge.to) || sanitizeMermaidId(edge.to);
        if (edge.label && edge.label.trim()) {
          const edgeLabel = sanitizeMermaidLabel(edge.label);
          lines.push(`  ${fromId} -->|"${edgeLabel}"| ${toId}`);
        } else {
          lines.push(`  ${fromId} --> ${toId}`);
        }
      }
      return lines.join("\n");
    }

    case "sequence": {
      const lines = ["sequenceDiagram"];
      const idMap = new Map();

      for (const p of diagramSpec.participants) {
        const safeId = sanitizeMermaidId(p.id);
        idMap.set(p.id, safeId);
        lines.push(`  participant ${safeId} as ${sanitizeMermaidLabel(p.label)}`);
      }

      for (const msg of diagramSpec.messages) {
        const fromId = idMap.get(msg.from) || sanitizeMermaidId(msg.from);
        const toId = idMap.get(msg.to) || sanitizeMermaidId(msg.to);
        lines.push(`  ${fromId}->>${toId}: ${sanitizeMermaidLabel(msg.label)}`);
      }
      return lines.join("\n");
    }

    case "timeline": {
      const lines = ["timeline", `  title ${sanitizeMermaidLabel(diagramSpec.title)}`];
      for (const ev of diagramSpec.events) {
        lines.push(
          `  ${sanitizeMermaidLabel(ev.period)} : ${sanitizeMermaidLabel(ev.label)}`
        );
      }
      return lines.join("\n");
    }

    case "er_diagram": {
      const CARDINALITY_MAP = {
        "one-to-one": "||--||",
        "one-to-many": "||--o{",
        "many-to-many": "}o--o{",
      };
      const lines = ["erDiagram"];
      const idMap = new Map();

      for (const ent of diagramSpec.entities) {
        const safeName = cleanIdentifierToken(ent.name || ent.id, "Entity").toUpperCase();
        idMap.set(ent.id, safeName);
        lines.push(`  ${safeName} {`);
        for (const attr of ent.attributes) {
          lines.push(`    string ${cleanIdentifierToken(attr, "field")}`);
        }
        lines.push("  }");
      }

      for (const rel of diagramSpec.relations) {
        const fromName = idMap.get(rel.from) || cleanIdentifierToken(rel.from, "Entity").toUpperCase();
        const toName = idMap.get(rel.to) || cleanIdentifierToken(rel.to, "Entity").toUpperCase();
        const op = CARDINALITY_MAP[rel.cardinality] || "||--o{";
        lines.push(`  ${fromName} ${op} ${toName} : "${sanitizeMermaidLabel(rel.label)}"`);
      }
      return lines.join("\n");
    }

    case "class_diagram": {
      const REL_MAP = {
        inheritance: "<|--",
        composition: "*--",
        aggregation: "o--",
        association: "-->",
      };
      const lines = ["classDiagram"];
      const idMap = new Map();

      for (const cls of diagramSpec.classes) {
        const safeId = sanitizeMermaidId(cls.id);
        const displayName = sanitizeMermaidLabel(cls.name || cls.id);
        idMap.set(cls.id, safeId);
        lines.push(`  class ${safeId}["${displayName}"] {`);
        for (const attr of cls.attributes) {
          lines.push(`    +${sanitizeMermaidLabel(attr)}`);
        }
        for (const method of cls.methods) {
          lines.push(`    +${sanitizeMethodSignature(method)}`);
        }
        lines.push("  }");
      }

      for (const rel of diagramSpec.relations) {
        const fromName = idMap.get(rel.from) || sanitizeMermaidId(rel.from);
        const toName = idMap.get(rel.to) || sanitizeMermaidId(rel.to);
        const op = REL_MAP[rel.type] || "-->";
        const suffix = rel.label ? ` : ${sanitizeMermaidLabel(rel.label)}` : "";
        lines.push(`  ${fromName} ${op} ${toName}${suffix}`);
      }
      return lines.join("\n");
    }

    default:
      throw new Error(`Mermaid adapter does not support kind: ${diagramSpec.kind}`);
  }
}
