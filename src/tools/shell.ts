import { execFile } from "child_process";
import { promisify } from "util";
import { resolveProjectPath, WORKSPACE_DIR } from "../workspace.js";
import * as fs from "fs";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;

export async function bash(args: {
  command: string;
  project?: string;
  timeout?: number;
}): Promise<string> {
  const timeoutMs = Math.min(
    args.timeout ? args.timeout * 1000 : DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS
  );

  // Determine working directory
  let cwd: string;
  if (args.project) {
    cwd = resolveProjectPath(args.project);
    if (!fs.existsSync(cwd)) {
      throw new Error(`Project "${args.project}" not found in workspace.`);
    }
  } else {
    cwd = WORKSPACE_DIR;
    fs.mkdirSync(cwd, { recursive: true });
  }

  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-c", args.command], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
      env: {
        ...process.env,
        // Make sure PATH includes common tool locations
        PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      },
    });

    const out = stdout.trim();
    const err = stderr.trim();

    if (out && err) return `stdout:\n${out}\n\nstderr:\n${err}`;
    if (out) return out;
    if (err) return `stderr:\n${err}`;
    return "(no output)";
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean };
    if (err.killed) {
      throw new Error(`Command timed out after ${timeoutMs / 1000}s`);
    }
    const combined = [err.stdout?.trim(), err.stderr?.trim()].filter(Boolean).join("\n");
    throw new Error(`Command failed (exit ${(err as { code?: number }).code ?? "?"}): ${combined || err.message}`);
  }
}
