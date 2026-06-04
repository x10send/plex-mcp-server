# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Commands

```bash
# Install dependencies
npm ci

# Start dev server (hot reload)
npm run dev

# Run all quality checks (format → lint → typecheck → test+coverage → build)
npm run check

# Run tests only
npm test

# Run a single test file
node --import tsx --test test/library.test.ts

# Run tests with coverage (enforces thresholds)
npm run test:coverage

# Type-check without emitting
npm run typecheck

# Format source
npm run format

# Build to dist/
npm run build

# Build Docker image locally
docker build -t plex-mcp-server .

# Run locally (direct token mode)
docker run --rm \
  -e PLEX_URL=http://192.168.1.x:32400 \
  -e PLEX_TOKEN=your-token \
  -p 3003:3000 \
  plex-mcp-server
```

The `npm run check` pipeline is the gate: format check → lint → typecheck → test+coverage → build. CI runs the same command.

## Architecture

Stateless Fastify HTTP server exposing MCP Streamable HTTP at `POST/GET/DELETE /mcp`. Each request creates a fresh `McpServer` + `StreamableHTTPServerTransport` pair (stateless mode, `sessionIdGenerator: undefined`).

**Token resolution per request:** `X-Plex-Token` header (injected by mcp-edge-gateway) → `PLEX_TOKEN` env var → 401. The token is never logged.

**Module responsibilities:**

- `src/server.ts` — entry point only: loads config, calls `buildApp`, binds socket, SIGTERM/SIGINT. Excluded from coverage.
- `src/app.ts` — Fastify app: health endpoint, MCP route, token resolution, per-request McpServer + transport lifecycle.
- `src/config.ts` — env loading, PLEX_URL SSRF validation (blocks public IPs at startup), log level and port validation.
- `src/plex-client.ts` — typed Plex HTTP API client. Exports `IPlexClient` interface (used for test mocking) and `PlexClient` implementation. `PlexApiError` for non-2xx responses.
- `src/tools/library.ts` — exports `registerLibraryTools(server, client)`. Tools: `get_libraries`, `get_library_contents`, `get_children`, `get_media_info`, `get_media_extras`.
- `src/tools/discovery.ts` — exports `registerDiscoveryTools(server, client)`. Tools: `search_media`, `get_genres`, `get_actors`, `get_directors`, `get_collections`, `get_collection_items`, `get_related`, `get_recently_added`, `get_on_deck`, `get_watch_history`, `get_random_items`.

## Testing

Tests use Node.js built-in test runner (`node:test`) with `InMemoryTransport` + `Client` from the MCP SDK for end-to-end tool invocation. No real Plex server or network calls in tests.

`test/helpers.ts` exports `makeMockClient()` (configurable mock implementing `IPlexClient`) and `callTool(register, toolName, args, client)` which wires up a full MCP server/client pair in-process and invokes the named tool.

Tool tests follow the pattern:
```typescript
const client = makeMockClient();
client.setResponse('/path', { MediaContainer: { ... } });
const { text, isError } = await callTool(registerFn, 'tool_name', { arg: 'val' }, client);
assert.match(text, /expected/);
```

Coverage thresholds (85% lines/functions, 70% branches) apply to `src/app.ts`, `src/plex-client.ts`, `src/config.ts`, and `src/tools/*.ts`. `src/server.ts` is excluded.

## Security Constraints

- The `X-Plex-Token` header is in Fastify's redact list — never appears in logs at any level.
- `PLEX_URL` is validated against RFC 1918 private ranges at startup. Public IPs are rejected. `.local` mDNS and `localhost` are always allowed.
- All tool arguments are validated with Zod. Invalid args return an MCP error, not an unhandled exception.
- Plex API error messages are truncated to 200 chars before being returned in tool error responses.
- `src/plex-client.ts` must not log or return the token value.
- No secrets in committed files. Real `PLEX_URL` and tokens belong in `.env` (gitignored) or the gateway config.

## Phases

- **Phase 1 (current):** Library & Discovery tools — `src/tools/library.ts` and `src/tools/discovery.ts`.
- **Phase 2:** Sessions & Server Health — `src/tools/sessions.ts`, `src/tools/server-ops.ts`.
- **Phase 3:** DVR & Live TV (Plex Pass required) — `src/tools/dvr.ts`, `src/tools/playlists.ts`.
