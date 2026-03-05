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
RUN apk add --no-cache git openssh-client bash

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

CMD ["node", "dist/index.js"]
