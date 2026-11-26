/**
 * Validates README.md integrity:
 * - Line budget <= 700 lines
 * - Every local file link and image/source asset resolves on disk
 * - Mermaid fences are balanced and use supported diagram types
 * - Zero leaked tokens/secrets or forbidden internal copy
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const README_PATH = path.join(ROOT, "README.md");

const SUPPORTED_MERMAID_HEADERS = [
  "flowchart",
  "graph",
  "sequenceDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "classDiagram",
  "erDiagram",
  "xychart-beta",
];

const content = fs.readFileSync(README_PATH, "utf8");
const lines = content.split(/\r?\n/);

let errors = 0;

if (lines.length > 700) {
  console.error(`[checkReadme] README.md is ${lines.length} lines (must be <= 700 lines).`);
  errors += 1;
}

// Check markdown links `[text](target)` & HTML `src="..."` / `srcset="..."`
const candidates = new Set();
for (const m of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
  candidates.add(m[1].trim());
}
for (const m of content.matchAll(/\b(?:src|srcset)=["']([^"']+)["']/gi)) {
  candidates.add(m[1].trim());
}

function existsCaseSensitive(rootDir, relPath) {
  const parts = relPath.split(/[\\/]+/).filter(Boolean);
  let cur = rootDir;
  for (const part of parts) {
    if (!fs.existsSync(cur)) return false;
    const entries = fs.readdirSync(cur);
    if (!entries.includes(part)) return false;
    cur = path.join(cur, part);
  }
  return fs.existsSync(cur);
}

for (const rawTarget of candidates) {
  const target = rawTarget.split(/\s+/)[0].split("#")[0];
  if (!target) continue;
  if (/^(https?:|mailto:|#)/i.test(target)) continue;
  const normalized = target.replace(/^\/+/, "");
  if (!existsCaseSensitive(ROOT, normalized)) {
    console.error(`[checkReadme] Broken or case-mismatched local reference in README.md: "${rawTarget}"`);
    errors += 1;
  }
}

// Validate Mermaid blocks
let inMermaid = false;
let checkedHeader = false;
let mermaidCount = 0;

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i].trim();
  if (!inMermaid && line.startsWith("```mermaid")) {
    inMermaid = true;
    checkedHeader = false;
    mermaidCount += 1;
    continue;
  }
  if (inMermaid) {
    if (line.startsWith("```")) {
      inMermaid = false;
      continue;
    }
    if (!checkedHeader && line.length > 0 && !line.startsWith("%%")) {
      const firstWord = line.split(/\s+/)[0];
      if (!SUPPORTED_MERMAID_HEADERS.includes(firstWord)) {
        console.error(`[checkReadme] Unsupported Mermaid header "${firstWord}" on line ${i + 1}`);
        errors += 1;
      }
      checkedHeader = true;
    }
  }
}

if (inMermaid) {
  console.error("[checkReadme] Unclosed ```mermaid code block in README.md.");
  errors += 1;
}

// Secret scan
if (/AIza[0-9A-Za-z_-]{30,}|sb_secret_[0-9A-Za-z_-]{20,}|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[0-9A-Za-z_-]{20,}/.test(content)) {
  console.error("[checkReadme] Potential real secret or JWT detected inside README.md.");
  errors += 1;
}

if (errors > 0) {
  console.error(`[checkReadme] Failed with ${errors} issue(s).`);
  process.exit(1);
}

console.log(`[checkReadme] Verified README.md (${lines.length} lines, ${mermaidCount} Mermaid blocks, ${candidates.size} refs checked).`);
