import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  getCliRenderTimeoutMs,
  getWorkerRoot,
  loadWorkerEnv,
  resolveBrowserPath,
} from "../config/env.js";

const execFileAsync = promisify(execFile);

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB bounded stdout/stderr

export class CliRendererError extends Error {
  constructor(message, { code = "CLI_RENDER_ERROR", stderr = "", exitCode = null, cause = null } = {}) {
    super(message, { cause });
    this.name = "CliRendererError";
    this.code = code;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

/**
 * Resolves the locally installed @excalidraw/cli entrypoint without invoking npx.
 */
export function resolveCliScriptPath() {
  const workerRoot = getWorkerRoot();
  const repoRoot = path.resolve(workerRoot, "../..");
  const candidates = [
    path.join(workerRoot, "node_modules", "@excalidraw", "cli", "dist", "main.js"),
    path.join(repoRoot, "node_modules", "@excalidraw", "cli", "dist", "main.js"),
  ];

  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new CliRendererError(
    "Local @excalidraw/cli entrypoint not found in node_modules. Run npm install first.",
    { code: "CLI_NOT_FOUND" }
  );
}

/**
 * Invokes a Node script safely via execFile with argument array and shell: false.
 */
async function runCliCommand({
  cliScriptPath,
  args,
  cwd,
  timeoutMs,
  signal,
  execFn = execFileAsync,
  nodeExecutable = process.execPath,
}) {
  try {
    const { stdout, stderr } = await execFn(nodeExecutable, [cliScriptPath, ...args], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: MAX_BUFFER_BYTES,
      windowsHide: true,
      shell: false,
      signal,
      env: {
        ...process.env,
        EXCALIDRAW_NO_UPDATE_NOTIFIER: "1",
      },
    });
    return { stdout: String(stdout || ""), stderr: String(stderr || "") };
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new CliRendererError("Excalidraw CLI operation was cancelled", {
        code: "CLI_CANCELLED",
        cause: err,
      });
    }
    if (err?.killed && err?.signal === "SIGTERM") {
      throw new CliRendererError(`Excalidraw CLI timed out after ${timeoutMs}ms`, {
        code: "CLI_TIMEOUT",
        stderr: String(err?.stderr || "").slice(0, 2000),
        cause: err,
      });
    }
    if (err?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      throw new CliRendererError("Excalidraw CLI output exceeded maxBuffer limit", {
        code: "CLI_BUFFER_OVERFLOW",
        cause: err,
      });
    }
    if (err?.code === "ENOENT") {
      throw new CliRendererError("Executable not found while invoking Excalidraw CLI", {
        code: "CLI_EXECUTABLE_MISSING",
        cause: err,
      });
    }
    throw new CliRendererError(
      `Excalidraw CLI failed (exit ${err?.code ?? "unknown"}): ${
        String(err?.stderr || err?.message || "").slice(0, 500)
      }`,
      {
        code: "CLI_EXEC_FAILED",
        stderr: String(err?.stderr || "").slice(0, 2000),
        exitCode: typeof err?.code === "number" ? err.code : 1,
        cause: err,
      }
    );
  }
}

function resolveRequiredBrowser(explicitBrowserPath) {
  loadWorkerEnv();
  const resolved = resolveBrowserPath({ envPath: explicitBrowserPath ?? process.env.EXCALIDRAW_BROWSER_PATH });
  if (!resolved.path) {
    throw new CliRendererError(
      "No Chromium/Chrome/Edge browser executable found. Set EXCALIDRAW_BROWSER_PATH.",
      { code: "BROWSER_NOT_FOUND" }
    );
  }
  return resolved.path;
}

/**
 * Converts a Mermaid definition string into an editable Excalidraw scene JSON object
 * using @excalidraw/cli inside an isolated temporary directory.
 */
export async function convertMermaidToExcalidraw({
  mermaidSource,
  browserPath,
  timeoutMs = getCliRenderTimeoutMs(),
  signal,
  cliScriptPath,
  execFn,
  tempPrefix = "visualify-mmd-",
}) {
  if (typeof mermaidSource !== "string" || !mermaidSource.trim()) {
    throw new CliRendererError("Mermaid source must be a non-empty string", {
      code: "INVALID_MERMAID_INPUT",
    });
  }

  const resolvedCli = cliScriptPath || resolveCliScriptPath();
  const resolvedBrowser = resolveRequiredBrowser(browserPath);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), tempPrefix));
  const startedAt = Date.now();

  try {
    // Always use internal fixed filenames; never pass user-controlled paths to CLI.
    const inputPath = path.join(workDir, "diagram.mmd");
    const outputPath = path.join(workDir, "scene.excalidraw");
    await fs.writeFile(inputPath, mermaidSource, "utf8");

    await runCliCommand({
      cliScriptPath: resolvedCli,
      args: [
        "mermaid",
        inputPath,
        "--out",
        outputPath,
        "--format",
        "excalidraw",
        "--browser-path",
        resolvedBrowser,
        "--timeout",
        String(timeoutMs),
      ],
      cwd: workDir,
      timeoutMs: timeoutMs + 5000,
      signal,
      execFn,
    });

    const rawScene = await fs.readFile(outputPath, "utf8");
    const scene = JSON.parse(rawScene);
    if (!scene || !Array.isArray(scene.elements)) {
      throw new CliRendererError("Converted Excalidraw output missing elements array", {
        code: "INVALID_SCENE_OUTPUT",
      });
    }

    return {
      scene,
      latencyMs: Date.now() - startedAt,
      browserPath: resolvedBrowser,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Renders an Excalidraw scene JSON object to PNG or SVG via @excalidraw/cli.
 */
export async function renderScene({
  sceneJson,
  format = "png",
  browserPath,
  timeoutMs = getCliRenderTimeoutMs(),
  scale = 1,
  signal,
  cliScriptPath,
  execFn,
  tempPrefix = "visualify-render-",
}) {
  if (!sceneJson || !Array.isArray(sceneJson.elements)) {
    throw new CliRendererError("Scene JSON must contain an elements array", {
      code: "INVALID_SCENE_INPUT",
    });
  }
  if (format !== "png" && format !== "svg") {
    throw new CliRendererError(`Unsupported render format: ${format}`, {
      code: "UNSUPPORTED_FORMAT",
    });
  }

  const resolvedCli = cliScriptPath || resolveCliScriptPath();
  const resolvedBrowser = resolveRequiredBrowser(browserPath);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), tempPrefix));
  const startedAt = Date.now();

  try {
    const inputPath = path.join(workDir, "scene.excalidraw");
    const outputPath = path.join(workDir, `export.${format}`);
    await fs.writeFile(inputPath, JSON.stringify(sceneJson), "utf8");

    const args = [
      "render",
      inputPath,
      "--out",
      outputPath,
      "--format",
      format,
      "--browser-path",
      resolvedBrowser,
      "--timeout",
      String(timeoutMs),
    ];
    if (format === "png" && scale !== 1) {
      args.push("--scale", String(scale));
    }

    await runCliCommand({
      cliScriptPath: resolvedCli,
      args,
      cwd: workDir,
      timeoutMs: timeoutMs + 5000,
      signal,
      execFn,
    });

    const buffer = await fs.readFile(outputPath);
    if (buffer.length === 0) {
      throw new CliRendererError(`Rendered ${format} file is empty`, {
        code: "EMPTY_RENDER_OUTPUT",
      });
    }

    if (format === "png" && !buffer.subarray(0, 8).equals(PNG_MAGIC)) {
      throw new CliRendererError("Rendered PNG failed magic-byte signature verification", {
        code: "INVALID_PNG_SIGNATURE",
      });
    }
    if (format === "svg" && !buffer.toString("utf8").includes("<svg")) {
      throw new CliRendererError("Rendered SVG missing <svg element", {
        code: "INVALID_SVG_OUTPUT",
      });
    }

    return {
      buffer,
      format,
      bytes: buffer.length,
      latencyMs: Date.now() - startedAt,
      browserPath: resolvedBrowser,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
