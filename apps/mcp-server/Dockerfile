# syntax=docker/dockerfile:1.7
# @ohmyperf/mcp-server Docker image.
# Build context MUST be the repo root (not apps/mcp-server) so pnpm can
# resolve `workspace:*` protocol entries.

ARG NODE_VERSION=22-bookworm-slim
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.60.0-jammy
ARG PNPM_VERSION=10.33.3

FROM node:${NODE_VERSION} AS build

ENV CI=true \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /repo

# Lockfile + workspace manifests first so dep changes don't bust the
# source-cache layer below.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY turbo.json tsconfig.base.json tsconfig.json ./
COPY apps/mcp-server/package.json apps/mcp-server/

# Workspace package manifests — copied before source so pnpm install
# resolves the full workspace dep graph.
COPY packages/core/package.json                packages/core/
COPY packages/design-tokens/package.json       packages/design-tokens/
COPY packages/driver-playwright/package.json   packages/driver-playwright/
COPY packages/fixers/package.json              packages/fixers/
COPY packages/plugins-builtin/package.json     packages/plugins-builtin/
COPY packages/reporter-deck/package.json       packages/reporter-deck/
COPY packages/reporter-html/package.json       packages/reporter-html/
COPY packages/reporter-json/package.json       packages/reporter-json/
COPY packages/reporter-markdown/package.json   packages/reporter-markdown/

# --ignore-scripts: don't download Playwright browsers here (they ship
# with the runtime image).
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @ohmyperf/mcp-server...

COPY packages/ packages/
COPY apps/mcp-server/ apps/mcp-server/
COPY eslint.config.js ./

# Trailing `...` = recursive: builds @ohmyperf/mcp-server and every
# workspace dep it imports.
RUN pnpm --filter @ohmyperf/mcp-server... build

# --legacy keeps pnpm 9 deploy semantics (pnpm 10 changed defaults).
RUN pnpm --filter @ohmyperf/mcp-server deploy --prod --legacy /out

FROM ${PLAYWRIGHT_IMAGE} AS runtime

LABEL org.opencontainers.image.title="ohmyperf MCP server" \
      org.opencontainers.image.description="MCP server exposing the ohmyperf engine for AI agents (Claude, OpenCode, Cursor, Cline, Continue, GitHub Copilot)." \
      org.opencontainers.image.source="https://github.com/hoainho/ohmyperf" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.documentation="https://github.com/hoainho/ohmyperf/tree/main/apps/mcp-server#readme" \
      org.opencontainers.image.vendor="ohmyperf" \
      io.modelcontextprotocol.server.name="ohmyperf" \
      io.modelcontextprotocol.server.version="0.1.1" \
      io.modelcontextprotocol.server.transport="stdio"

USER pwuser
WORKDIR /home/pwuser/app

ENV NODE_ENV=production \
    OHMYPERF_MCP_REPORTS_DIR=/home/pwuser/app/.ohmyperf-mcp/reports \
    OHMYPERF_MCP_MAX_REPORTS=50

# Self-contained deploy: bin, dist, node_modules, package.json, README, LICENSE, NOTICE.
COPY --from=build --chown=pwuser:pwuser /out ./

# Persistent state dirs — mount -v $PWD/reports:<dir> at runtime.
RUN mkdir -p /home/pwuser/app/.ohmyperf-mcp/reports \
             /home/pwuser/app/.ohmyperf-mcp/timeseries

# JSON-RPC `initialize` ping per MCP 2024-11-05 spec. Stdio transport
# has no port to probe, so we speak the protocol and check for "result".
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD sh -c 'printf "%s" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"docker-healthcheck\",\"version\":\"0\"}}}" | node /home/pwuser/app/bin/ohmyperf-mcp.mjs 2>/dev/null | grep -q "\"result\""'

ENTRYPOINT ["node", "/home/pwuser/app/bin/ohmyperf-mcp.mjs"]
