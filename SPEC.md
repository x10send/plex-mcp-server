# plex-mcp-server — Project Specification

## Purpose

A Model Context Protocol (MCP) server that exposes Plex Media Server as a set of AI-callable tools. Enables AI assistants (Claude, etc.) to browse libraries, discover and recommend content, monitor sessions and server health, and surface DVR/Live TV schedules — all via the local Plex HTTP API. Designed to run as a Docker container on Unraid and sit behind [`mcp-edge-gateway`](https://github.com/x10send/mcp-edge-gateway) for OAuth and Cloudflare Tunnel access.

Tools are **read-only** with one exception: DVR recording management. Claude can schedule and cancel recordings from the Live TV guide. All other write operations (mark watched, rate, create playlist, library scans, playback control) are out of scope.

---

## Primary User Stories

- "What should I watch tonight? I'm in the mood for something funny and light."
- "What good sci-fi haven't I seen yet?"
- "What's been added recently?"
- "What recordings do I have coming up this week?"
- "What's on live TV right now?"
- "Show me everything by Christopher Nolan in my library."
- "What does Plex think is related to Interstellar?"
- "Is the server doing anything right now? Any scans running?"

---

## Ecosystem Fit

```
Claude / Claude Code
      │  HTTPS + OAuth
      ▼
mcp-edge-gateway  (Cloudflare Tunnel, OAuth 2.1, tool filtering)
      │  HTTP (LAN)
      ▼
plex-mcp-server   (this project — port 3003 on Unraid host)
      │  HTTP + X-Plex-Token
      ▼
Plex Media Server (port 32400)
```

Authentication and external access are handled entirely by the gateway. This server is a trusted local bridge — no auth layer of its own.

---

## Technology

| Concern | Choice |
|---|---|
| Runtime | Node.js 20 (LTS), TypeScript |
| MCP SDK | `@modelcontextprotocol/sdk` (official) |
| HTTP server | Fastify 5 (Streamable HTTP transport) |
| Validation | Zod |
| Transport | MCP Streamable HTTP on port 3000 (container) → 3003 (Unraid host) |
| Container | node:20-alpine, non-root `mcp` user, multi-arch (amd64 + arm64) |
| CI/CD | GitHub Actions → GHCR (`ghcr.io/x10send/plex-mcp-server`) |
| Releases | `vX.Y.Z` tags; `latest` + semver tags published |

---

## Configuration (Environment Variables)

| Variable | Required | Description |
|---|---|---|
| `PLEX_URL` | Yes | Base URL of Plex Media Server, e.g. `http://192.168.1.x:32400` |
| `PLEX_TOKEN` | No* | Plex authentication token — used if `X-Plex-Token` header is not forwarded by the gateway |
| `PLEX_CLIENT_ID` | No | Stable UUID sent as `X-Plex-Client-Identifier` (auto-generated if omitted) |
| `MCP_PORT` | No | Port to listen on (default `3000`) |
| `LOG_LEVEL` | No | Fastify log level: `trace`, `debug`, `info`, `warn`, `error` (default `info`) |

*Token resolution order per request: `X-Plex-Token` header (gateway-injected) → `PLEX_TOKEN` env var → reject with 401. Prefer the header; the env var is a fallback for direct deployments without the gateway. If neither is present the request fails — the server does not start in a degraded mode.

No configuration file — environment variables only. Secrets never baked into the image.

### Gateway-injected token (recommended)

In the gateway admin UI, when adding the `/plex` route, set:
- **Auth type:** Custom header
- **Env var name:** `PLEX_TOKEN` (set this on the gateway container)
- **Header name:** `X-Plex-Token`

The gateway then injects the Plex token on every proxied request. Plex validates the token server-side, so no additional trust logic is needed in the MCP server.

---

## MCP Tools

### Library & Browse

| Tool | Plex API | Description |
|---|---|---|
| `get_libraries` | `GET /library/sections` | List all library sections with IDs, types, and item counts |
| `get_library_contents` | `GET /library/sections/:id/all` | Paginated, filterable item list — supports `genre`, `unwatched`, `year`, `contentRating`, `studio`, `sort`, `limit`, `offset` |
| `get_children` | `GET /library/metadata/:id/children` | Drill into a show's seasons, a season's episodes, or an album's tracks |
| `get_media_info` | `GET /library/metadata/:id` | Full metadata for a single item by rating key |
| `get_media_extras` | `GET /library/metadata/:id/extras` | Trailers, featurettes, and interviews attached to a title |

### Discovery & Recommendations

| Tool | Plex API | Description |
|---|---|---|
| `search_media` | `GET /search` | Full-text search across all libraries |
| `get_genres` | `GET /library/sections/:id/genre` | List all genres present in a library section |
| `get_actors` | `GET /library/sections/:id/actor` | List actors present in a library section |
| `get_directors` | `GET /library/sections/:id/director` | List directors present in a library section |
| `get_collections` | `GET /library/sections/:id/collections` | List smart and manual collections in a section |
| `get_collection_items` | `GET /library/collections/:id/children` | Items in a specific collection |
| `get_related` | `GET /library/metadata/:id/related` | Plex's own related-content engine for a title |
| `get_recently_added` | `GET /library/recentlyAdded` | Recently added items, optionally scoped to a section |
| `get_on_deck` | `GET /library/onDeck` | In-progress items with percent-watched |
| `get_watch_history` | `GET /status/sessions/history/all` | What was watched, when, and how far — filterable by account or library |
| `get_random_items` | `GET /library/sections/:id/all` | Random sample from a library or filtered subset (uses Plex `sort=random`) |

### Sessions & Active Streams

| Tool | Plex API | Description |
|---|---|---|
| `get_active_sessions` | `GET /status/sessions` | All active streams: user, title, player, state, progress, transcode decision |
| `get_transcode_sessions` | `GET /transcode/sessions` | Active transcoding jobs with codec, quality, speed, and throttle state |

### Server Health & Operations

| Tool | Plex API | Description |
|---|---|---|
| `get_server_info` | `GET /` | Server version, machine ID, platform, active transcoder count |
| `get_server_statistics` | `GET /statistics/resources` | CPU, RAM, and network usage over time |
| `get_activities` | `GET /activities` | Background tasks in progress — library scans, metadata refreshes, media analysis |
| `get_butler_tasks` | `GET /butler` | Scheduled butler task list and their last-run/next-run times |

### DVR & Live TV *(Plex Pass + tuner required)*

| Tool | Read/Write | Plex API | Description |
|---|---|---|---|
| `get_dvr_devices` | Read | `GET /livetv/dvr` | Available tuners and DVR devices |
| `get_scheduled_recordings` | Read | `GET /media/subscriptions` | Upcoming scheduled recordings with title, channel, and time |
| `get_live_tv_guide` | Read | `GET /livetv/sessions` + EPG | What's on live TV now and coming up |
| `schedule_recording` | **Write** | `POST /media/subscriptions` | Schedule a new recording for a program from the guide |
| `cancel_recording` | **Write** | `DELETE /media/subscriptions/:id` | Cancel a scheduled recording by subscription ID |

### Playlists *(read-only)*

| Tool | Plex API | Description |
|---|---|---|
| `get_playlists` | `GET /playlists` | All playlists (audio, video, photo) with item counts |
| `get_playlist_items` | `GET /playlists/:id/items` | Items in a specific playlist |

---

## Tool Design Notes

**Filtering on `get_library_contents`:** The Plex `/library/sections/:id/all` endpoint accepts filter query params directly. Claude should use `get_genres` first to discover valid genre strings, then pass them as filters — this is far more efficient than fetching everything and filtering client-side.

**`get_random_items`:** Plex supports `sort=random` as a native sort order on library endpoints. Combine with filters (e.g. `unwatched=1&genre=Comedy`) to get a random unwatched comedy.

**`get_related`:** Returns Plex's own similarity results — hub sections like "More by this director", "Similar movies", etc. This is the primary mechanism for mood-based chained recommendations.

**DVR tools:** Only available if the server has a Plex Pass subscription and a connected tuner/DVR device. Tools should return a clear "DVR not available" message rather than error when the capability is absent.

**`get_watch_history`:** Returns playback history with account ID, item rating key, viewed-at timestamp, and completion percent. Claude can use this for "have I seen this?" and "what did I watch last week?" queries.

---

## Gateway Configuration

```yaml
routes:
  - path: /plex
    upstream: http://<unraid-ip>:3003
    tools:
      toolScopes:
        schedule_recording: [plex:dvr]
        cancel_recording: [plex:dvr]
```

Most tools are read-only and need only a token with `plex:read` scope. The two DVR write tools are gated behind a separate `plex:dvr` scope so recording management can be granted independently. Issue tokens with both scopes for full access, or `plex:read` only for a read-only token.

The gateway's default deny list blocks tools matching `*delete*` — `cancel_recording` avoids this pattern intentionally. If the default deny list is active, no additional allow-list entry is needed for any tool in this server.

---

## Project Structure

```
plex-mcp-server/
├── src/
│   ├── server.ts              # Entry point: env, bind, SIGTERM
│   ├── app.ts                 # Fastify + MCP Streamable HTTP wiring
│   ├── plex-client.ts         # Typed Plex HTTP API client
│   └── tools/
│       ├── library.ts         # get_libraries, get_library_contents, get_children, get_media_info, get_media_extras
│       ├── discovery.ts       # search, genres, actors, directors, collections, related, recently added, on deck, history, random
│       ├── sessions.ts        # get_active_sessions, get_transcode_sessions
│       ├── server.ts          # get_server_info, get_server_statistics, get_activities, get_butler_tasks
│       ├── dvr.ts             # get_dvr_devices, get_scheduled_recordings, get_live_tv_guide, schedule_recording, cancel_recording
│       └── playlists.ts       # get_playlists, get_playlist_items
├── test/
│   ├── library.test.ts
│   ├── discovery.test.ts
│   ├── sessions.test.ts
│   ├── server.test.ts
│   ├── dvr.test.ts
│   └── playlists.test.ts
├── unraid/
│   ├── plex-mcp-server.xml    # Community Apps template
│   └── icon.png
├── .github/workflows/
│   └── release.yml            # Build + push to GHCR on vX.Y.Z tags
├── Dockerfile
├── docker-compose.yml
├── CLAUDE.md
├── SPEC.md
├── README.md
├── CHANGELOG.md
├── package.json
├── tsconfig.json
└── eslint.config.js
```

---

## Phases

### Phase 1 — Library, Discovery & Recommendations
`get_libraries`, `get_library_contents` (with filters), `get_children`, `get_media_info`, `get_media_extras`, `search_media`, `get_genres`, `get_actors`, `get_directors`, `get_collections`, `get_collection_items`, `get_related`, `get_recently_added`, `get_on_deck`, `get_watch_history`, `get_random_items`

Full project scaffolding: Dockerfile, CI, Unraid template, CLAUDE.md, README, gateway wiring docs.

All tools are read-only and require only a valid Plex token — no special server capabilities needed.

### Phase 2 — Sessions & Server Health
`get_active_sessions`, `get_transcode_sessions`, `get_server_info`, `get_server_statistics`, `get_activities`, `get_butler_tasks`

Read-only ops/monitoring tools. Validates the server is reachable and well-formed before moving to DVR.

### Phase 3 — DVR & Live TV
`get_dvr_devices`, `get_scheduled_recordings`, `get_live_tv_guide`, `schedule_recording`, `cancel_recording`, `get_playlists`, `get_playlist_items`

Requires Plex Pass and a tuner. Read tools degrade gracefully if DVR is not configured. Write tools (`schedule_recording`, `cancel_recording`) require the `plex:dvr` gateway scope.

---

## Open Source

Licensed MIT. Published to GitHub under `x10send/plex-mcp-server` and GHCR as `ghcr.io/x10send/plex-mcp-server`.

Every contributor must follow the same rules as `mcp-edge-gateway`:
- No real hostnames, IPs, tokens, or credentials in committed files — ever
- A `CONTRIBUTING.md` covering branch → PR → review → merge flow, test requirements, and the security constraints below
- A `SECURITY.md` with a responsible disclosure policy and contact

---

## Quality Bar

### Testing
- Every tool handler has unit tests with a mocked Plex client — no real Plex server required in CI
- Tests cover the happy path, malformed/missing input, and Plex API error responses (4xx, 5xx)
- Coverage thresholds enforced in CI: ≥85% lines, ≥85% functions, ≥70% branches across all `src/tools/*.ts` and `src/plex-client.ts`
- The `npm run check` pipeline (format → lint → typecheck → test+coverage → build) is the single gate; CI runs the same command
- No test may make real network calls — all Plex HTTP calls must go through the injectable client

### Code
- TypeScript strict mode throughout; no `any` in tool handlers or the Plex client
- All tool inputs validated with Zod before use; validation errors return structured MCP error responses, not stack traces
- `hadolint` must pass clean on the Dockerfile

### Releases
- Image runs as non-root (`mcp` user)
- Multi-arch: `linux/amd64` + `linux/arm64`
- SBOM and provenance attestation on every release tag
- npm dependencies pinned to exact versions in `package-lock.json`; `npm ci` used in Docker builds

---

## Security

### Token handling
- The Plex token (`X-Plex-Token` header or `PLEX_TOKEN` env var) is **never logged** at any log level
- The token is **never included** in MCP tool responses, error messages, or structured output
- Fastify's request logger must redact the `x-plex-token` header before writing any log line

### Input validation
- All tool arguments are validated with Zod before being passed to the Plex client; invalid input returns an MCP error, not an unhandled exception
- `rating_key`, `section_id`, `playlist_id`, and similar ID parameters are validated as non-empty strings and sanitised before interpolating into URL paths — no path traversal

### SSRF prevention
- `PLEX_URL` is validated at startup: must be a valid HTTP/HTTPS URL pointing to a private-network address (RFC 1918 / RFC 4193). The server refuses to start if `PLEX_URL` resolves to a public IP
- The Plex client never follows redirects to different hosts

### Error handling
- Plex API errors (4xx, 5xx) are translated to structured MCP error responses; raw upstream error bodies are not forwarded verbatim to the AI client
- Stack traces are logged server-side but never returned in MCP responses

### Dependencies
- `npm audit` must pass with zero high/critical findings before any release
- Dependabot enabled for weekly dependency updates

### What this server does NOT do
- No inbound authentication — that is entirely the gateway's responsibility
- No outbound calls except to `PLEX_URL` — no telemetry, no analytics, no external services

---

## Logging

Structured JSON logs via Fastify's built-in logger (Pino). Every log line includes a timestamp and log level.

| Event | Level | Fields |
|---|---|---|
| Server started | `info` | port, plexUrl (host only, no token) |
| Incoming MCP request | `info` | tool name, method |
| Plex API call | `debug` | method, path (no query params containing token) |
| Plex API error | `warn` | status, path, truncated message |
| Tool result | `debug` | tool name, result summary (no media content) |
| Unhandled error | `error` | stack trace |
| Server shutdown | `info` | signal received |

`LOG_LEVEL` env var controls verbosity (default `info`). In production `info` is sufficient; `debug` is for local development. `trace` logs raw HTTP — never use in production as it may expose query parameters.

The `x-plex-token` header is in Fastify's redact list and will appear as `[Redacted]` in all log output regardless of log level.

---

## Out of Scope

- Write operations beyond DVR scheduling (mark watched, rate, create playlist, scan library, etc.)
- Playback control (separate server if needed in future)
- Photo library management
- User/home account management
- Plex.tv cloud features (requires Plex.tv API, not local)
- Offline sync / downloads
- Notification agent configuration
