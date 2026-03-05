import * as path from "path";
import * as fs from "fs";

export const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? "/workspace";

/**
 * Resolves a project name to its absolute path, guarding against path traversal.
 * Throws if the resolved path escapes the workspace root.
 */
export function resolveProjectPath(project: string): string {
  const resolved = path.resolve(WORKSPACE_DIR, project);
  if (!resolved.startsWith(path.resolve(WORKSPACE_DIR) + path.sep) && resolved !== path.resolve(WORKSPACE_DIR)) {
    throw new Error(`Invalid project name: "${project}" (path traversal detected)`);
  }
  return resolved;
}

/**
 * Resolves a file path within a project, guarding against path traversal.
 */
export function resolveFilePath(project: string, filePath: string): string {
  const projectRoot = resolveProjectPath(project);
  const resolved = path.resolve(projectRoot, filePath);
  if (!resolved.startsWith(projectRoot + path.sep) && resolved !== projectRoot) {
    throw new Error(`Invalid path: "${filePath}" escapes project root`);
  }
  return resolved;
}

/**
 * Lists all top-level directories in the workspace (each represents a project).
 */
export function listProjects(): string[] {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    return [];
  }
  return fs
    .readdirSync(WORKSPACE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/**
 * Returns true if a project directory exists in the workspace.
 */
export function projectExists(project: string): boolean {
  try {
    const p = resolveProjectPath(project);
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
