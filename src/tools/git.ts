import simpleGit, { SimpleGit } from "simple-git";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import { WORKSPACE_DIR, resolveProjectPath, projectExists } from "../workspace.js";

// ---------------------------------------------------------------------------
// GitLab / provider config from environment
// ---------------------------------------------------------------------------

const GITLAB_URL = (process.env.GITLAB_URL ?? "").replace(/\/$/, ""); // e.g. https://gitlab.example.com
const GITLAB_TOKEN = process.env.GITLAB_TOKEN ?? "";

/**
 * Injects authentication into a git clone URL.
 *
 * Rules:
 *  - If the URL already contains credentials, leave it as-is.
 *  - If the host matches the configured GITLAB_URL and GITLAB_TOKEN is set,
 *    inject `oauth2:<token>@` before the hostname.
 *  - Otherwise return the URL unchanged (SSH URLs, public repos, etc.).
 */
function injectAuth(rawUrl: string, overrideToken?: string): string {
  const token = overrideToken ?? "";

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    // SSH or non-standard URL — leave unchanged
    return rawUrl;
  }

  // Already has credentials
  if (url.username || url.password) return rawUrl;

  // Determine which token to use
  let effectiveToken = token;
  if (!effectiveToken && GITLAB_TOKEN) {
    const configuredHost = GITLAB_URL ? new URL(GITLAB_URL).hostname : "";
    if (!configuredHost || url.hostname === configuredHost) {
      effectiveToken = GITLAB_TOKEN;
    }
  }

  if (!effectiveToken) return rawUrl;

  url.username = "oauth2";
  url.password = effectiveToken;
  return url.toString();
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export async function checkoutProject(args: {
  url: string;
  name?: string;
  branch?: string;
  token?: string;
  insecure?: boolean;
}): Promise<string> {
  const { url, branch, token, insecure } = args;

  // Derive project name from URL if not provided
  const name = args.name ?? path.basename(url, ".git");
  const destPath = resolveProjectPath(name);

  if (fs.existsSync(destPath)) {
    throw new Error(`Project "${name}" already exists. Use remove_project first or choose a different name.`);
  }

  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  const authUrl = injectAuth(url, token);
  const git: SimpleGit = simpleGit();

  const cloneOptions: string[] = [];
  if (branch) {
    cloneOptions.push("--branch", branch);
  }
  if (insecure) {
    cloneOptions.push("-c", "http.sslVerify=false");
  }

  await git.clone(authUrl, destPath, cloneOptions);

  // Configure git identity inside the repo (prevents commit errors)
  const repoGit = simpleGit(destPath);
  await repoGit.addConfig("user.email", process.env.GIT_EMAIL ?? "sandbox@localhost");
  await repoGit.addConfig("user.name", process.env.GIT_USER ?? "Sandbox Agent");
  if (insecure) {
    await repoGit.addConfig("http.sslVerify", "false");
  }

  const branchInfo = branch ? ` (branch: ${branch})` : "";
  const sslNote = insecure ? " [SSL verification disabled]" : "";
  return `Checked out "${name}" from ${url}${branchInfo} → ${destPath}${sslNote}`;
}

export async function listProjects(): Promise<string> {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    return "Workspace is empty — no projects checked out yet.";
  }
  const entries = fs
    .readdirSync(WORKSPACE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  if (entries.length === 0) return "Workspace is empty — no projects checked out yet.";
  return entries.map((e) => `• ${e}`).join("\n");
}

export async function removeProject(args: { name: string }): Promise<string> {
  const p = resolveProjectPath(args.name);
  if (!fs.existsSync(p)) {
    throw new Error(`Project "${args.name}" not found in workspace.`);
  }
  fs.rmSync(p, { recursive: true, force: true });
  return `Removed project "${args.name}" from workspace.`;
}

export async function gitStatus(args: { project: string }): Promise<string> {
  const p = resolveProjectPath(args.project);
  if (!projectExists(args.project)) throw new Error(`Project "${args.project}" not found.`);
  const git = simpleGit(p);
  const status = await git.status();
  const lines: string[] = [];
  lines.push(`Branch: ${status.current ?? "unknown"}`);
  lines.push(`Ahead: ${status.ahead}, Behind: ${status.behind}`);
  if (status.staged.length) lines.push(`Staged: ${status.staged.join(", ")}`);
  if (status.modified.length) lines.push(`Modified: ${status.modified.join(", ")}`);
  if (status.not_added.length) lines.push(`Untracked: ${status.not_added.join(", ")}`);
  if (status.deleted.length) lines.push(`Deleted: ${status.deleted.join(", ")}`);
  if (status.conflicted.length) lines.push(`Conflicted: ${status.conflicted.join(", ")}`);
  if (lines.length === 2) lines.push("Working tree clean.");
  return lines.join("\n");
}

export async function gitPull(args: { project: string; branch?: string }): Promise<string> {
  const p = resolveProjectPath(args.project);
  if (!projectExists(args.project)) throw new Error(`Project "${args.project}" not found.`);
  const git = simpleGit(p);
  const result = await git.pull("origin", args.branch);
  return `Pulled ${args.project}: ${result.summary.changes} change(s), ${result.summary.insertions} insertion(s), ${result.summary.deletions} deletion(s).`;
}

export async function gitLog(args: { project: string; limit?: number }): Promise<string> {
  const p = resolveProjectPath(args.project);
  if (!projectExists(args.project)) throw new Error(`Project "${args.project}" not found.`);
  const git = simpleGit(p);
  const log = await git.log({ maxCount: args.limit ?? 10 });
  return log.all
    .map((c) => `${c.hash.slice(0, 8)} ${c.date.slice(0, 10)} ${c.author_name}: ${c.message}`)
    .join("\n");
}

export async function createBranch(args: {
  project: string;
  branch: string;
  from?: string;
  push?: boolean;
}): Promise<string> {
  const p = resolveProjectPath(args.project);
  if (!projectExists(args.project)) throw new Error(`Project "${args.project}" not found.`);
  const git = simpleGit(p);

  // Checkout base ref first if specified
  if (args.from) {
    await git.checkout(args.from);
  }

  // Create and switch to the new branch
  await git.checkoutLocalBranch(args.branch);

  let result = `Created and switched to branch "${args.branch}" in project "${args.project}".`;

  if (args.push) {
    await git.push("origin", args.branch, ["--set-upstream"]);
    result += ` Pushed to origin.`;
  }

  return result;
}

export async function gitCheckoutBranch(args: { project: string; branch: string }): Promise<string> {
  const p = resolveProjectPath(args.project);
  if (!projectExists(args.project)) throw new Error(`Project "${args.project}" not found.`);
  const git = simpleGit(p);
  await git.checkout(args.branch);
  return `Switched to branch "${args.branch}" in project "${args.project}".`;
}

export async function listBranches(args: { project: string; remote?: boolean }): Promise<string> {
  const p = resolveProjectPath(args.project);
  if (!projectExists(args.project)) throw new Error(`Project "${args.project}" not found.`);
  const git = simpleGit(p);
  const branches = await git.branch(args.remote ? ["-r"] : []);
  const current = branches.current;
  return Object.keys(branches.branches)
    .map((b) => (b === current ? `* ${b}` : `  ${b}`))
    .join("\n");
}

export async function gitCommit(args: {
  project: string;
  message: string;
  add?: boolean;
}): Promise<string> {
  const p = resolveProjectPath(args.project);
  if (!projectExists(args.project)) throw new Error(`Project "${args.project}" not found.`);
  const git = simpleGit(p);

  if (args.add) {
    await git.add(".");
  }

  const result = await git.commit(args.message);
  if (!result.commit) {
    return "Nothing to commit — working tree is clean.";
  }
  return `Committed ${result.commit} in "${args.project}": ${args.message} (${result.summary.changes} change(s), +${result.summary.insertions}/-${result.summary.deletions})`;
}

export async function gitPush(args: {
  project: string;
  branch?: string;
  force?: boolean;
}): Promise<string> {
  const p = resolveProjectPath(args.project);
  if (!projectExists(args.project)) throw new Error(`Project "${args.project}" not found.`);
  const git = simpleGit(p);

  const pushOptions: string[] = ["--set-upstream"];
  if (args.force) pushOptions.push("--force-with-lease");

  const status = await git.status();
  const branch = args.branch ?? status.current ?? "HEAD";

  await git.push("origin", branch, pushOptions);
  return `Pushed "${args.project}" branch "${branch}" to origin.`;
}

// ---------------------------------------------------------------------------
// GitLab Merge Request / GitHub Pull Request creation
// ---------------------------------------------------------------------------

function gitlabApiRequest(opts: {
  method: string;
  hostname: string;
  path: string;
  token: string;
  body?: object;
  insecure?: boolean;
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const bodyStr = opts.body ? JSON.stringify(opts.body) : undefined;
    const reqOptions: https.RequestOptions = {
      hostname: opts.hostname,
      path: opts.path,
      method: opts.method,
      headers: {
        "PRIVATE-TOKEN": opts.token,
        "Content-Type": "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
      },
      rejectUnauthorized: !opts.insecure,
    };

    const req = https.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        try {
          const json = JSON.parse(text);
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`GitLab API ${res.statusCode}: ${json.message ?? text}`));
          } else {
            resolve(json);
          }
        } catch {
          reject(new Error(`GitLab API non-JSON response (${res.statusCode}): ${text}`));
        }
      });
    });

    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function githubApiRequest(opts: {
  method: string;
  hostname: string;
  path: string;
  token: string;
  body?: object;
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const bodyStr = opts.body ? JSON.stringify(opts.body) : undefined;
    const reqOptions: https.RequestOptions = {
      hostname: opts.hostname,
      path: opts.path,
      method: opts.method,
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
        "User-Agent": "agentic-sandbox-mcp",
        Accept: "application/vnd.github+json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = https.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        try {
          const json = JSON.parse(text) as Record<string, unknown>;
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`GitHub API ${res.statusCode}: ${(json.message as string) ?? text}`));
          } else {
            resolve(json);
          }
        } catch {
          reject(new Error(`GitHub API non-JSON response (${res.statusCode}): ${text}`));
        }
      });
    });

    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

export async function createMergeRequest(args: {
  project: string;
  title: string;
  sourceBranch?: string;
  targetBranch?: string;
  description?: string;
  token?: string;
  insecure?: boolean;
}): Promise<string> {
  const p = resolveProjectPath(args.project);
  if (!projectExists(args.project)) throw new Error(`Project "${args.project}" not found.`);

  const git = simpleGit(p);
  const status = await git.status();
  const sourceBranch = args.sourceBranch ?? status.current ?? "HEAD";

  // Detect remote URL to figure out provider and project path
  const remotes = await git.getRemotes(true);
  const origin = remotes.find((r) => r.name === "origin");
  if (!origin) throw new Error(`No "origin" remote found in project "${args.project}".`);

  const remoteUrl = origin.refs.fetch || origin.refs.push;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(remoteUrl);
  } catch {
    // SSH remote: git@host:owner/repo.git
    const sshMatch = remoteUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (!sshMatch) throw new Error(`Cannot parse remote URL: ${remoteUrl}`);
    parsedUrl = new URL(`https://${sshMatch[1]}/${sshMatch[2]}`);
  }

  const hostname = parsedUrl.hostname;
  const repoPath = parsedUrl.pathname.replace(/^\//, "").replace(/\.git$/, "");

  // GitHub
  if (hostname === "github.com") {
    const token = args.token ?? process.env.GITHUB_TOKEN ?? "";
    if (!token) throw new Error("GitHub token required. Pass token or set GITHUB_TOKEN env.");
    const [owner, repo] = repoPath.split("/");
    const body = {
      title: args.title,
      head: sourceBranch,
      base: args.targetBranch ?? "main",
      body: args.description ?? "",
    };
    const result = await githubApiRequest({
      method: "POST",
      hostname: "api.github.com",
      path: `/repos/${owner}/${repo}/pulls`,
      token,
      body,
    }) as Record<string, unknown>;
    return `Pull Request created: ${result.html_url}`;
  }

  // GitLab (cloud or self-hosted)
  const token = args.token ?? GITLAB_TOKEN;
  if (!token) throw new Error("GitLab token required. Pass token or set GITLAB_TOKEN env.");

  const encodedPath = encodeURIComponent(repoPath);
  const targetBranch = args.targetBranch ?? "main";

  // Resolve default branch if target not specified
  let resolvedTarget = targetBranch;
  if (!args.targetBranch) {
    try {
      const projectInfo = await gitlabApiRequest({
        method: "GET",
        hostname,
        path: `/api/v4/projects/${encodedPath}`,
        token,
        insecure: args.insecure,
      }) as Record<string, unknown>;
      resolvedTarget = (projectInfo.default_branch as string) ?? "main";
    } catch {
      // fall back to "main"
    }
  }

  const body = {
    title: args.title,
    source_branch: sourceBranch,
    target_branch: resolvedTarget,
    description: args.description ?? "",
    remove_source_branch: false,
  };

  const result = await gitlabApiRequest({
    method: "POST",
    hostname,
    path: `/api/v4/projects/${encodedPath}/merge_requests`,
    token,
    body,
    insecure: args.insecure,
  }) as Record<string, unknown>;

  return `Merge Request created: ${result.web_url}`;
}
