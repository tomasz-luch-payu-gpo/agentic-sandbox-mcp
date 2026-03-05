import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import * as http from "http";
import { randomUUID } from "crypto";

import {
  checkoutProject,
  listProjects,
  removeProject,
  gitStatus,
  gitPull,
  gitLog,
  createBranch,
  gitCheckoutBranch,
  listBranches,
} from "./tools/git.js";
import { readFile, writeFile, listDirectory, searchFiles } from "./tools/filesystem.js";
import { bash } from "./tools/shell.js";

// ---------------------------------------------------------------------------
// Create MCP server and register tools
// ---------------------------------------------------------------------------

function buildServer(): McpServer {
  const server = new McpServer({
    name: "agentic-sandbox",
    version: "1.0.0",
  });

  // --- Git tools ---

  server.tool(
    "checkout_project",
    "Clone a git repository into the workspace. Supports GitHub, GitLab (cloud or self-hosted), and any HTTPS/SSH git remote.",
    {
      url: z.string().describe("Git repository URL (HTTPS or SSH)"),
      name: z.string().optional().describe("Local project folder name (defaults to repo name)"),
      branch: z.string().optional().describe("Branch or tag to checkout (defaults to default branch)"),
      token: z.string().optional().describe("Personal access token for private repos (overrides GITLAB_TOKEN env)"),
    },
    async (args) => {
      const text = await checkoutProject(args);
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "list_projects",
    "List all projects (repositories) currently checked out in the workspace.",
    {},
    async () => {
      const text = await listProjects();
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "remove_project",
    "Remove a project from the workspace (deletes the directory).",
    {
      name: z.string().describe("Project name to remove"),
    },
    async (args) => {
      const text = await removeProject(args);
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "git_status",
    "Show the git status of a project (current branch, modified files, etc.).",
    {
      project: z.string().describe("Project name"),
    },
    async (args) => {
      const text = await gitStatus(args);
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "git_pull",
    "Pull the latest changes from the remote for a project.",
    {
      project: z.string().describe("Project name"),
      branch: z.string().optional().describe("Remote branch to pull (defaults to current branch)"),
    },
    async (args) => {
      const text = await gitPull(args);
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "git_log",
    "Show recent commit history for a project.",
    {
      project: z.string().describe("Project name"),
      limit: z.number().int().min(1).max(100).optional().describe("Number of commits to show (default 10)"),
    },
    async (args) => {
      const text = await gitLog(args);
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "create_branch",
    "Create a new git branch in a project and optionally push it to origin.",
    {
      project: z.string().describe("Project name"),
      branch: z.string().describe("New branch name"),
      from: z.string().optional().describe("Base branch/commit to create from (defaults to current HEAD)"),
      push: z.boolean().optional().describe("Push the new branch to origin (default false)"),
    },
    async (args) => {
      const text = await createBranch(args);
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "checkout_branch",
    "Switch to an existing branch in a project.",
    {
      project: z.string().describe("Project name"),
      branch: z.string().describe("Branch name to switch to"),
    },
    async (args) => {
      const text = await gitCheckoutBranch(args);
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "list_branches",
    "List local (or remote) branches in a project.",
    {
      project: z.string().describe("Project name"),
      remote: z.boolean().optional().describe("List remote branches instead of local (default false)"),
    },
    async (args) => {
      const text = await listBranches(args);
      return { content: [{ type: "text", text }] };
    }
  );

  // --- Filesystem tools ---

  server.tool(
    "read_file",
    "Read the contents of a file in a project.",
    {
      project: z.string().describe("Project name"),
      path: z.string().describe("File path relative to project root"),
    },
    async (args) => {
      const text = readFile(args);
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "write_file",
    "Create or overwrite a file in a project.",
    {
      project: z.string().describe("Project name"),
      path: z.string().describe("File path relative to project root"),
      content: z.string().describe("File content"),
    },
    async (args) => {
      const text = writeFile(args);
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "list_directory",
    "List the contents of a directory in a project.",
    {
      project: z.string().describe("Project name"),
      path: z.string().optional().describe("Directory path relative to project root (defaults to project root)"),
    },
    async (args) => {
      const text = listDirectory(args);
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "search_files",
    "Search for files matching a glob pattern in a project (node_modules and .git are excluded).",
    {
      project: z.string().describe("Project name"),
      pattern: z.string().describe("Glob pattern, e.g. '**/*.ts', '*.json', 'src/**/*.test.js'"),
    },
    async (args) => {
      const text = searchFiles(args);
      return { content: [{ type: "text", text }] };
    }
  );

  // --- Shell tool ---

  server.tool(
    "bash",
    "Execute a shell command inside the container, scoped to a project directory. Use this to run builds, tests, linters, package managers, etc.",
    {
      command: z.string().describe("Shell command to execute"),
      project: z.string().optional().describe("Project name (command runs in its directory). Omit to run in workspace root."),
      timeout: z.number().int().min(1).max(300).optional().describe("Timeout in seconds (default 30, max 300)"),
    },
    async (args) => {
      const text = await bash(args);
      return { content: [{ type: "text", text }] };
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// Transport selection
// ---------------------------------------------------------------------------

const TRANSPORT = process.env.MCP_TRANSPORT ?? "stdio"; // "stdio" | "http"
const PORT = parseInt(process.env.PORT ?? "3000", 10);
const AUTH_TOKEN = process.env.AUTH_TOKEN ?? "";

async function startStdio(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("MCP agentic-sandbox running on stdio\n");
}

async function startHttp(): Promise<void> {
  // Map of session id -> transport (supports multiple concurrent sessions)
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    // Optional bearer token auth
    if (AUTH_TOKEN) {
      const authHeader = req.headers["authorization"] ?? "";
      if (authHeader !== `Bearer ${AUTH_TOKEN}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    if (req.url === "/mcp" || req.url?.startsWith("/mcp?")) {
      const sessionId = (req.headers["mcp-session-id"] as string | undefined) ?? randomUUID();

      let transport = transports.get(sessionId);
      if (!transport) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
          onsessioninitialized: (id) => {
            transports.set(id, transport!);
          },
        });
        transport.onclose = () => {
          transports.delete(sessionId);
        };
        const server = buildServer();
        await server.connect(transport);
      }

      await transport.handleRequest(req, res, await readBody(req));
      return;
    }

    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", transport: "http", sessions: transports.size }));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  httpServer.listen(PORT, () => {
    process.stderr.write(`MCP agentic-sandbox listening on http://0.0.0.0:${PORT}/mcp\n`);
  });
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

if (TRANSPORT === "http") {
  startHttp().catch((e) => {
    process.stderr.write(`Fatal: ${e}\n`);
    process.exit(1);
  });
} else {
  startStdio().catch((e) => {
    process.stderr.write(`Fatal: ${e}\n`);
    process.exit(1);
  });
}
