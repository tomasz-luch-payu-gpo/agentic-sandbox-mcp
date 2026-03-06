import * as fs from "fs";
import * as path from "path";
import { resolveFilePath, resolveProjectPath, WORKSPACE_DIR } from "../workspace.js";

/**
 * Resolves the absolute path for a file operation.
 * If project is given, resolves relative to that project directory.
 * If project is omitted and filePath is absolute (starting with /workspace),
 * allows direct access to any path under WORKSPACE_DIR.
 */
function resolveAnyFilePath(project: string | undefined, filePath: string): string {
  if (project) {
    return resolveFilePath(project, filePath);
  }
  // Absolute path mode — must stay within workspace
  const absPath = path.resolve(filePath);
  const wsRoot = path.resolve(WORKSPACE_DIR);
  if (!absPath.startsWith(wsRoot + path.sep) && absPath !== wsRoot) {
    throw new Error(`Path "${filePath}" is outside the workspace. Only paths under ${WORKSPACE_DIR} are allowed.`);
  }
  return absPath;
}

export function readFile(args: { project?: string; path: string }): string {
  const filePath = resolveAnyFilePath(args.project, args.path);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${args.path}`);
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Path is not a file: ${args.path}`);
  }
  const MAX_BYTES = 1_000_000; // 1 MB limit
  if (stat.size > MAX_BYTES) {
    throw new Error(`File is too large (${stat.size} bytes). Use bash to stream it.`);
  }
  return fs.readFileSync(filePath, "utf-8");
}

export function writeFile(args: { project?: string; path: string; content: string }): string {
  const filePath = resolveAnyFilePath(args.project, args.path);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, args.content, "utf-8");
  return `Written ${args.content.length} chars to ${args.path}`;
}

export function listDirectory(args: { project: string; path?: string }): string {
  const dirPath = args.path
    ? resolveFilePath(args.project, args.path)
    : resolveProjectPath(args.project);

  if (!fs.existsSync(dirPath)) {
    throw new Error(`Directory not found: ${args.path ?? "/"}`);
  }
  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${args.path}`);
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries
    .sort((a, b) => {
      // Dirs first, then files, then alphabetical
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    })
    .map((e) => (e.isDirectory() ? `📁 ${e.name}/` : `📄 ${e.name}`))
    .join("\n");
}

export function searchFiles(args: { project: string; pattern: string }): string {
  const projectRoot = resolveProjectPath(args.project);
  const results: string[] = [];

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // Skip common noise directories
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".DS_Store") {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (matchGlob(entry.name, args.pattern) || matchGlob(full.slice(projectRoot.length + 1), args.pattern)) {
        results.push(full.slice(projectRoot.length + 1)); // relative path
      }
    }
  }

  walk(projectRoot);
  if (results.length === 0) return `No files matching "${args.pattern}" found.`;
  return results.join("\n");
}

/** Very simple glob: supports * and ** wildcards */
function matchGlob(str: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "(.+)")
    .replace(/\*/g, "([^/]*)");
  return new RegExp(`^${escaped}$`).test(str);
}
