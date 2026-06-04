# Contributing

## Development Setup

```bash
git clone https://github.com/x10send/plex-mcp-server
cd plex-mcp-server
npm ci
npm run dev
```

## Making Changes

1. Branch from `main`: `git checkout -b feat/your-feature`
2. Write code and tests
3. Run `npm run check` — this must pass clean before opening a PR
4. Open a PR; at least one review is required before merge

## Quality Gate

`npm run check` runs: format check → lint → typecheck → test+coverage → build.

All must pass. Coverage thresholds (85% lines/functions, 70% branches) are enforced in CI.

## Testing Rules

- Every tool handler must have tests covering: happy path, empty results, and Plex API error (4xx/5xx)
- Tests use `makeMockClient()` from `test/helpers.ts` — no real Plex server or network calls in CI
- `callTool(register, toolName, args, client)` is the standard test pattern; use it consistently

## Security Rules

- No real hostnames, IPs, tokens, or credentials in committed files — ever
- The Plex token must never appear in log output; Fastify redacts it via the `redact` config
- New tools must validate all inputs with Zod before passing them to `PlexClient`
- Plex API error messages must be truncated (≤200 chars) before appearing in MCP error responses
- `npm audit` must report zero high/critical findings

## Adding a New Tool

1. Decide which file it belongs in (`library.ts`, `discovery.ts`, or a new Phase file)
2. Call `server.tool(name, description, zodShape, handler)` inside the `register*Tools` function
3. Catch `PlexApiError` and unknown errors separately; use the `toolError(err)` helper pattern
4. Write tests in the matching `test/*.test.ts` file
5. Document the tool in `SPEC.md` and `CLAUDE.md`

## Commit Messages

Short present-tense summary (≤72 chars), e.g.:
- `add get_watch_history tool`
- `fix: truncate Plex error messages in tool responses`
- `test: add coverage for get_random_items empty result`

## Versioning

`vX.Y.Z` — semantic versioning. Pushing a tag triggers the release workflow and publishes to GHCR.
