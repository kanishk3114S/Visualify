import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");

function walk(dir, filter) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git", "renders", "test-results", "playwright-report"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

let errors = 0;

// 1. Syntax check every backend/worker/scripts/test ESM file (non-JSX)
const jsFiles = [
  ...walk(path.join(ROOT, "backend"), (f) => f.endsWith(".js")),
  ...walk(path.join(ROOT, "supabase"), (f) => f.endsWith(".js")),
  ...walk(path.join(ROOT, "scripts"), (f) => f.endsWith(".js")),
  ...walk(path.join(ROOT, "tests"), (f) => f.endsWith(".js")),
];
for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    console.error(`Syntax error in ${path.relative(ROOT, file)}:\n${err.stderr?.toString()}`);
    errors += 1;
  }
}

// 2. Verify exact dependency version pinning (no ^ or ~ in dependencies/devDependencies)
for (const pkgRel of ["package.json", "backend/package.json", "backend/worker/package.json", "frontend/package.json"]) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, pkgRel), "utf8"));
  for (const section of ["dependencies", "devDependencies", "overrides"]) {
    for (const [name, ver] of Object.entries(pkg[section] ?? {})) {
      if (typeof ver === "string" && /^[\^~*]/.test(ver.trim())) {
        console.error(`Unpinned dependency ${name}@${ver} in ${pkgRel} (${section})`);
        errors += 1;
      }
    }
  }
}

// 3. Ensure no source files under frontend/src reference server-only secret names
const feFiles = walk(path.join(ROOT, "frontend/src"), (f) => /\.(js|jsx)$/.test(f));
for (const file of feFiles) {
  const txt = fs.readFileSync(file, "utf8");
  if (/SUPABASE_SERVICE_ROLE_KEY|GEMINI_API_KEY|REDIS_URL/.test(txt)) {
    console.error(`Forbidden server secret reference in frontend file: ${path.relative(ROOT, file)}`);
    errors += 1;
  }
}

if (errors > 0) {
  console.error(`Lint failed with ${errors} issue(s).`);
  process.exit(1);
}
console.log(`Lint passed (${jsFiles.length} JS files syntax-checked, dependencies pinned, frontend secret boundaries clean).`);
