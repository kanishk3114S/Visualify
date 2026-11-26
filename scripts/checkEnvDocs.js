/**
 * Verifies that every environment variable read in backend/worker/frontend schemas
 * is documented cleanly in the matching `.env.example` and in `README.md`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function extractApiEnvKeys() {
  const src = read("backend/src/config/env.js");
  const match = src.match(/const envSchema = z\.object\(\{([\s\S]*?)\n\}\);/);
  if (!match) throw new Error("Unable to locate envSchema in backend/src/config/env.js");
  const keys = [];
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^\s{2}([A-Z][A-Z0-9_]+):/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

function extractWorkerEnvKeys() {
  const src = read("backend/worker/src/config/env.js");
  const keys = new Set();
  for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) {
    keys.add(m[1]);
  }
  return [...keys];
}

function extractFrontendEnvKeys() {
  const files = ["frontend/src/lib/env.js", "frontend/src/lib/sentry.js"];
  const keys = new Set();
  for (const f of files) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    const src = read(f);
    for (const m of src.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) {
      keys.add(m[1]);
    }
  }
  return [...keys];
}

const apiKeys = extractApiEnvKeys();
const workerKeys = extractWorkerEnvKeys();
const frontendKeys = extractFrontendEnvKeys();

const backendExample = read("backend/.env.example");
const workerExample = read("backend/worker/.env.example");
const frontendExample = read("frontend/.env.example");
const readme = read("README.md");

let errors = 0;

for (const key of apiKeys) {
  if (!backendExample.includes(key)) {
    console.error(`[checkEnvDocs] Missing ${key} in backend/.env.example`);
    errors += 1;
  }
  if (!readme.includes(`\`${key}\``)) {
    console.error(`[checkEnvDocs] Missing \`${key}\` in README.md environment table`);
    errors += 1;
  }
}

for (const key of workerKeys) {
  if (!workerExample.includes(key) && !backendExample.includes(key)) {
    console.error(`[checkEnvDocs] Missing worker env var ${key} in .env.example files`);
    errors += 1;
  }
  if (!readme.includes(`\`${key}\``)) {
    console.error(`[checkEnvDocs] Missing \`${key}\` in README.md environment table`);
    errors += 1;
  }
}

for (const key of frontendKeys) {
  if (!frontendExample.includes(key)) {
    console.error(`[checkEnvDocs] Missing ${key} in frontend/.env.example`);
    errors += 1;
  }
  if (!readme.includes(`\`${key}\``)) {
    console.error(`[checkEnvDocs] Missing \`${key}\` in README.md environment table`);
    errors += 1;
  }
}

if (errors > 0) {
  console.error(`[checkEnvDocs] Failed with ${errors} missing environment documentation item(s).`);
  process.exit(1);
}

console.log(
  `[checkEnvDocs] Verified ${apiKeys.length} API vars, ${workerKeys.length} worker vars, and ${frontendKeys.length} frontend vars against .env.example & README.md.`
);
