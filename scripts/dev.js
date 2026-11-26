/**
 * Runs both the Express API (`dev:api`) and Vite frontend (`dev:frontend`)
 * concurrently in a single terminal with prefixed output and clean shutdown.
 */
import path from "node:path";
import readline from "node:readline";
import { execFileSync, spawn } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");

const SERVICES = [
  { name: "api", color: "\x1b[36m", script: "dev:api" },
  { name: "web", color: "\x1b[32m", script: "dev:frontend" },
];

const RESET = "\x1b[0m";
const children = [];
let shuttingDown = false;

function spawnWorkspaceScript(scriptName) {
  const npmCli = process.env.npm_execpath;
  if (npmCli) {
    return spawn(process.execPath, [npmCli, "run", scriptName], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  if (process.platform === "win32") {
    return spawn(process.env.ComSpec || "cmd.exe", ["/c", "npm", "run", scriptName], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  return spawn("npm", ["run", scriptName], {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function pipePrefixed(stream, prefix, target) {
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  rl.on("line", (line) => {
    target.write(`${prefix} ${line}\n`);
  });
}

function killChildTree(child) {
  if (!child.pid || child.exitCode !== null || child.killed) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      // Fallback to standard kill if the process already exited.
    }
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // Ignore already-exited child.
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    killChildTree(child);
  }
  process.exit(exitCode);
}

for (const svc of SERVICES) {
  const child = spawnWorkspaceScript(svc.script);
  children.push(child);

  const label = `${svc.color}[${svc.name}]${RESET}`;
  pipePrefixed(child.stdout, label, process.stdout);
  pipePrefixed(child.stderr, label, process.stderr);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    process.stderr.write(`${label} exited with ${reason}; stopping remaining processes.\n`);
    shutdown(code && code !== 0 ? code : 0);
  });

  child.on("error", (err) => {
    if (shuttingDown) return;
    process.stderr.write(`${label} failed to start: ${err.message}\n`);
    shutdown(1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
