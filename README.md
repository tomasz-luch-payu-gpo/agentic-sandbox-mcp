# agentic-sandbox-mcp

An MCP (Model Context Protocol) server that runs inside Docker, providing a safe isolated environment for AI coding agents (Claude Code, GitHub Copilot, etc.) to check out repositories, edit files, and run shell commands — without touching your host OS.

## Why?

- **Safety**: agents run in an isolated container; no risk of OS corruption or accidental host file changes
- **Reproducibility**: clean, consistent environment every time
- **Multi-provider git**: works with GitHub, GitLab (cloud or self-hosted), or any HTTPS/SSH remote

---

## Quick Start

### 1. Build and start (HTTP transport)

```bash
cp .env.example .env
# Edit .env with your GITLAB_URL / GITLAB_TOKEN if needed
docker compose up --build -d
```

### 2. Register with Claude Code CLI

```bash
# Without auth token
claude mcp add --transport http --scope local sandbox http://localhost:3000/mcp

# With AUTH_TOKEN set in .env
claude mcp add --transport http --scope local sandbox http://localhost:3000/mcp \
  --header "Authorization: Bearer YOUR_AUTH_TOKEN"
```

### 3. Verify inside Claude Code

```
/mcp
```

You should see `sandbox` listed as connected. Now ask Claude to:

> "Checkout https://github.com/org/repo, then run the tests"

---

## Docker Desktop MCP Toolkit (stdio transport)

Docker Desktop's MCP toolkit connects to servers via **stdio** — it runs the container and communicates through stdin/stdout. This is the easiest way to add the server without keeping a persistent container running.

### Option A — via `claude mcp add` (recommended)

```bash
# Build the image first
docker build -t agentic-sandbox-mcp .

# Register as a stdio MCP server
claude mcp add --transport stdio --scope local sandbox \
  -- docker run -i --rm \
    -v mcp-sandbox-workspace:/workspace \
    -e GITLAB_URL="https://gitlab.mycompany.com" \
    -e GITLAB_TOKEN="glpat-xxxx" \
    -e GIT_EMAIL="me@example.com" \
    -e GIT_USER="My Name" \
    agentic-sandbox-mcp
```

The `--` separates MCP flags from the docker command. Claude Code will start/stop the container automatically per session.

### Option B — Claude Desktop / `.mcp.json` (project-level)

Create `.mcp.json` in your project root (or `~/.claude.json` for global):

```json
{
  "mcpServers": {
    "sandbox": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "mcp-sandbox-workspace:/workspace",
        "-e", "GITLAB_URL=https://gitlab.mycompany.com",
        "-e", "GITLAB_TOKEN=glpat-xxxx",
        "-e", "GIT_EMAIL=me@example.com",
        "-e", "GIT_USER=My Name",
        "agentic-sandbox-mcp"
      ]
    }
  }
}
```

### Option C — Docker Desktop GUI

1. Open Docker Desktop → Settings → Features in Development → **MCP Toolkit**
2. Click **Add server**
3. Choose "Run a container" and enter:
   - **Image**: `agentic-sandbox-mcp` (after `docker build -t agentic-sandbox-mcp .`)
   - **Volume**: `mcp-sandbox-workspace:/workspace`
   - **Environment**: `GITLAB_TOKEN=glpat-xxxx`, `GITLAB_URL=https://...`

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` or `http` |
| `PORT` | `3000` | HTTP port (HTTP transport only) |
| `AUTH_TOKEN` | _(none)_ | Optional Bearer token for HTTP endpoint |
| `GITLAB_URL` | _(none)_ | Self-hosted GitLab base URL, e.g. `https://gitlab.example.com` |
| `GITLAB_TOKEN` | _(none)_ | GitLab Personal Access Token (api + read/write_repository scopes) |
| `GIT_EMAIL` | `sandbox@localhost` | Git commit author email |
| `GIT_USER` | `Sandbox Agent` | Git commit author name |
| `WORKSPACE_DIR` | `/workspace` | Path inside container where projects are stored |

---

## Available MCP Tools

### Git

| Tool | Description |
|------|-------------|
| `checkout_project` | Clone a repo into the workspace (injects GitLab auth automatically) |
| `list_projects` | List all checked-out projects |
| `remove_project` | Delete a project from workspace |
| `git_status` | Show branch, modified/staged/untracked files |
| `git_pull` | Pull latest from remote |
| `git_log` | Show recent commit history |
| `create_branch` | Create a new branch (optionally push to origin) |
| `checkout_branch` | Switch to an existing branch |
| `list_branches` | List local or remote branches |

### Filesystem

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Create or overwrite a file |
| `list_directory` | List directory contents |
| `search_files` | Glob search across a project (excludes node_modules/.git) |

### Shell

| Tool | Description |
|------|-------------|
| `bash` | Run any shell command inside the container, scoped to a project dir |

---

## GitLab Authentication

Private repos are authenticated automatically when `GITLAB_TOKEN` and `GITLAB_URL` are set.

The token is injected into the clone URL as `oauth2:<token>@<host>` — your token is never stored in git config or logs on the host.

For per-checkout token overrides, pass `token` directly to `checkout_project`:

> "Checkout https://gitlab.example.com/group/repo with token glpat-xxxx"

---

## Workspace Persistence

Projects checked out inside the container are stored in a Docker **named volume** (`mcp-sandbox-workspace`). They survive container restarts and image rebuilds.

To inspect or back up the workspace:

```bash
# List projects
docker run --rm -v mcp-sandbox-workspace:/ws alpine ls /ws

# Backup
docker run --rm -v mcp-sandbox-workspace:/ws -v $(pwd):/backup alpine \
  tar czf /backup/workspace-backup.tar.gz -C /ws .
```

---

## Docker Desktop Gordon AI integration

Docker Desktop 4.42+ includes **Gordon**, an AI agent that reads a `gordon-mcp.yml` file in your working directory to discover MCP servers.

```bash
# Build the image once
docker build -t agentic-sandbox-mcp .

# Drop into any project directory and start a Gordon session
cp /path/to/agentic-sandbox-mcp/gordon-mcp.yml .
docker ai "checkout https://github.com/org/repo and run the tests"
```

Gordon will automatically start the container, call the MCP tools, and stop it when done.

---

## Docker MCP Catalog (public registry)

To submit to the official Docker MCP catalog (`hub.docker.com/catalogs/mcp`) so anyone can discover and run the server from Docker Desktop:

1. **Push your image** to Docker Hub:
   ```bash
   docker build -t yourorg/agentic-sandbox-mcp:latest .
   docker push yourorg/agentic-sandbox-mcp:latest
   ```

2. **Fork** [github.com/docker/mcp-registry](https://github.com/docker/mcp-registry)

3. **Create** `servers/agentic-sandbox/` and copy in the three files from this repo:
   ```
   servers/agentic-sandbox/
   ├── server.yaml    # registry metadata + env config
   ├── tools.json     # tool listing shown in Docker Desktop UI
   └── readme.md      # description shown in catalog (copy README.md)
   ```
   Update `image:` in `server.yaml` to `docker.io/yourorg/agentic-sandbox-mcp`.

4. **Open a PR** — Docker team reviews, builds, signs, and publishes the image to `mcp/agentic-sandbox` on Docker Hub.

Once published, users can enable it in Docker Desktop → Settings → MCP Toolkit with a single toggle, and all environment variables (`GITLAB_TOKEN`, `GITLAB_URL`, etc.) are filled in via the Docker Desktop UI.

---

## Development

```bash
npm install
npm run build     # compile TypeScript -> dist/
npm start         # run with stdio transport (for local testing)

# Or HTTP mode
MCP_TRANSPORT=http npm start
```
