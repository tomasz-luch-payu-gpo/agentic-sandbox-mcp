# syntax=docker/dockerfile:1
FROM node:20-alpine AS builder

RUN apk add --no-cache git

WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- runtime image ----
FROM node:20-alpine

# git + ssh for cloning repos; bash for the shell tool
# openjdk21-jdk for Java projects; maven for Maven builds; curl for HTTP calls
RUN apk add --no-cache \
    git \
    openssh-client \
    bash \
    curl \
    openjdk21-jdk \
    maven

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /build/dist ./dist

# Workspace volume — all checked-out projects live here
VOLUME /workspace
ENV WORKSPACE_DIR=/workspace

# Transport: "stdio" (default, for Docker Desktop MCP) or "http"
ENV MCP_TRANSPORT=stdio
ENV PORT=3000

# GitLab configuration (set at runtime via -e flags or docker-compose env)
# GITLAB_URL=https://gitlab.example.com
# GITLAB_TOKEN=<personal-access-token>

# Optional bearer token auth (HTTP transport only)
# AUTH_TOKEN=<secret>

# Git identity used when committing inside the container
ENV GIT_EMAIL=sandbox@localhost
ENV GIT_USER="Sandbox Agent"

EXPOSE 3000

# OCI image labels (used by Docker Desktop MCP catalog and toolkit)
LABEL org.opencontainers.image.title="Agentic Sandbox MCP"
LABEL org.opencontainers.image.description="MCP server for safely checking out and working on git repositories (GitLab, GitHub) inside an isolated Docker container"
LABEL org.opencontainers.image.source="https://github.com/tomasz-luch-payu-gpo/agentic-sandbox-mcp"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.version="1.0.0"

CMD ["node", "dist/index.js"]
