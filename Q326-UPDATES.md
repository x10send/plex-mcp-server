# Q3 2026 Security Updates

> Audit date: 2026-08-30 · Branch: `main` @ `98f7fdd`
> Source: automated infosec subagent audit + `npm audit`

---

## P0 — Critical (ship this sprint)

These are directly exploitable from any authenticated MCP client with no preconditions.

### P0-1 · Path traversal + LLM prompt injection via `get_recently_added` section_id

**File:** `src/tools/discovery.ts:284`

`section_id` is declared `z.string().optional()` and interpolated directly into a URL path:

```ts
`/library/sections/${section_id}/recentlyAdded`
```

Every other tool that accepts a section ID uses the shared `NUMERIC_ID` validator (`z.string().regex(/^\d+$/)`). Passing `section_id = "1/../../metadata/1"` causes the server to request an arbitrary Plex API path using the admin token. Additionally, a malicious media title in the Plex library (prompt injection) could instruct an LLM to pass a crafted `section_id`, silently pivoting to DVR subscription data or other admin endpoints.

**Fix:** Change line 284–286 from:
```ts
section_id: z
  .string()
  .optional()
```
to:
```ts
section_id: NUMERIC_ID.optional()
```
`NUMERIC_ID` is already imported in this file. One-line change; add a test asserting numeric-only validation.

---

### P0-2 · Debug parameter exposes raw Plex internals to any MCP caller

**File:** `src/tools/dvr.ts` (four tools: `get_scheduled_recordings`, `schedule_recording`, `update_recording`, `cancel_recording`)

Each DVR tool accepts a `debug: z.union([z.boolean(), z.string()])` parameter. When `true`, it returns raw Plex API JSON containing DVR device IDs, hardware keys, provider IDs, and full subscription objects — up to 8,000 characters. There is no server-side gate; any MCP client (or a prompt-injected LLM) can pass `debug: true`. A secondary leak exists unconditionally: when title resolution fails in `get_scheduled_recordings`, all field names of the raw subscription object are emitted as a hint without requiring `debug: true`.

**Fix:**
- Remove `debug` from all four tool input schemas.
- Gate the raw-response dump behind a server-side `DEBUG_MCP=true` env var checked at request time, never exposed as a tool argument.
- Fix the unconditional field-name leak in the title-resolution fallback path.

---

## P1 — High (next sprint)

### P1-1 · Six HIGH-severity vulnerabilities in production dependencies

`npm audit` reports 6 HIGH vulns (0 critical), all with fixes available:

| Package | CVE area | Fix |
|---|---|---|
| `hono` ≤4.12.33 | Body-limit bypass, header injection (12 CVEs) | `npm audit fix` |
| `ip-address` ≤10.3.0 | Leading-zero octet SSRF bypass, CIDR special-use bypass | `npm audit fix` |
| `fast-uri` 3.0.0–3.1.4 | Host confusion via backslash (3 CVEs) | `npm audit fix` |
| `find-my-way` ≤9.6.0 | HTTP/2 DDoS (mitigated: server uses HTTP/1.1) | `npm audit fix` |
| `@hono/node-server` | Inherited from `hono` | `npm audit fix` |

`hono` and `ip-address` are the most impactful — both are production runtime deps brought in by `@modelcontextprotocol/sdk`. The `ip-address` SSRF-bypass CVEs are particularly relevant given the server's SSRF threat model.

**Fix:** Run `npm audit fix`. If MCP SDK hasn't yet published a compatible patch, add `overrides` in `package.json` to force the patched minor versions.

> Note: `js-yaml` (HIGH) and `brace-expansion` (HIGH) reported by audit are dev-only transitive deps via `eslint` — not present in the production image. Address in a routine dev-toolchain update.

---

### P1-2 · No request timeout — slow loris / hung-connection DoS

**File:** `src/app.ts:40`

Fastify 5 defaults to `requestTimeout: 0` (disabled). A client that opens a TCP connection and sends headers slowly — or sends headers but never a body — holds a connection handle indefinitely. The SSE streaming path for MCP responses adds further surface before `reply.hijack()` is called.

**Fix:** Set in the Fastify constructor:
```ts
const app = Fastify({
  requestTimeout: 30_000,
  connectionTimeout: 60_000,
  // ...
});
```

---

### P1-3 · No rate limiting

**File:** `src/app.ts`

The `/mcp` endpoint has no per-IP throttle. `get_library_contents` requests up to 10,000 items from Plex per call (`"X-Plex-Container-Size": "10000"`). A misbehaving or compromised LLM client can hammer this endpoint, exhausting Plex server resources and server memory.

**Fix:** Add `@fastify/rate-limit`:
```ts
await app.register(import('@fastify/rate-limit'), {
  max: 60,
  timeWindow: '1 minute',
});
```
Tune per-environment. The edge gateway may already handle this — if so, document the assumption and add a defensive inner limit anyway.

---

## P2 — Medium (Q3 milestone)

### P2-1 · SSRF filter misses special-use IP ranges

**File:** `src/config.ts:14–41`

`isPrivateIPv4` correctly blocks RFC 1918, loopback, CGNAT, and link-local. Missing:
- `0.0.0.0/8` (this host)
- `192.0.0.0/24` (IANA special-purpose)
- `198.51.100.0/24`, `203.0.113.0/24` (TEST-NETs)
- `224.0.0.0/4` (multicast)

These addresses wouldn't reach a real Plex server, but blocking them makes the allowlist complete and removes any ambiguity if the validation logic is reused elsewhere.

**Fix:** Extend `isPrivateIPv4` with the missing ranges, or replace the hand-rolled list with the `is-in-subnet` package (once `ip-address` is patched).

---

### P2-2 · Fastify default error handler may leak internal error messages

**File:** `src/app.ts:73–79`

The `/mcp` handler has no `catch` before `reply.hijack()`. If `mcpServer.connect()` throws, Fastify's default error serializer returns `{"message": "<error text>"}` to the caller. That text could contain internal paths, config values, or SDK internals.

**Fix:** Wrap the pre-hijack connect in a try/catch that returns a sanitized 500:
```ts
try {
  await mcpServer.connect(transport);
  reply.hijack();
} catch {
  return reply.status(500).send({ error: 'Internal error' });
}
```
Or register a `setErrorHandler` that scrubs all 500 messages globally.

---

### P2-3 · `search_media` query has no maximum length

**File:** `src/tools/discovery.ts:60`

`query` is `z.string().min(1)` with no upper bound. A 100 KB query string is forwarded to Plex as a URL query parameter, risking `414 URI Too Long` errors and wasted CPU in URL construction.

**Fix:** `z.string().min(1).max(500)`.

---

### P2-4 · `get_watch_history` `library_section_id` unvalidated

**File:** `src/tools/discovery.ts:370`

`library_section_id` is `z.string().optional()` and forwarded as a query parameter (`params["librarySectionID"]`). URLSearchParams encoding prevents injection, but consistency with every other section ID in the codebase calls for `NUMERIC_ID.optional()` here too.

**Fix:** `library_section_id: NUMERIC_ID.optional()`.

---

## P3 — Low / Hardening (backlog)

### P3-1 · Docker base image uses floating tag

**File:** `Dockerfile:1`

`FROM node:20-alpine` resolves to whatever Docker Hub serves at build time. A supply-chain compromise or accidental tag reassignment silently changes the base.

**Fix:** Pin to a digest: `FROM node:20-alpine@sha256:<current-digest>`. Automate digest refresh with Dependabot or Renovate.

---

### P3-2 · No HTTP security headers

**File:** `src/app.ts`

No `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, or `Strict-Transport-Security` headers are set. Low risk for a LAN-only MCP endpoint, but relevant if responses ever reach a browser context via gateway.

**Fix:** `await app.register(import('@fastify/helmet'))` with defaults. At minimum, `X-Content-Type-Options: nosniff`.

---

### P3-3 · Hardcoded version strings out of sync with package.json

**Files:** `src/app.ts:29`, `src/plex-client.ts:36`

`McpServer({ version: "0.1.0" })` and `"X-Plex-Version": "0.1.0"` are hardcoded. `package.json` is at `0.4.40`.

**Fix:** Import version dynamically:
```ts
import { createRequire } from 'module';
const { version } = createRequire(import.meta.url)('../../package.json');
```
Or inject via build step.

---

### P3-4 · `sort` parameter is a free-form string

**Files:** `src/tools/library.ts:251`, `src/tools/library.ts:303`

`sort` is `z.string().optional()`. URLSearchParams encoding prevents query-string injection, but an allowlist communicates intent and prevents unexpected Plex API behavior.

**Fix:** Constrain to a `z.enum([...])` of known Plex sort fields (e.g. `"title"`, `"year"`, `"rating"`, `"addedAt"`, `"titleSort"`).

---

### P3-5 · DNS rebinding window (acknowledged)

**File:** `src/config.ts`, `src/server.ts`

SSRF validation is a startup-only DNS lookup. Per-request `fetch()` re-resolves the hostname, creating a rebinding window. This is documented in `SECURITY.md` and mitigated by using a static IP in `PLEX_URL`.

**No code change required.** Consider caching the resolved IP at startup and constructing requests against the IP directly (with a `Host:` override) to close this permanently.

---

## Summary

| Priority | # | Item | Effort |
|---|---|---|---|
| **P0** | P0-1 | Path traversal via `section_id` in `get_recently_added` | XS |
| **P0** | P0-2 | Debug param exposes raw Plex internals | S |
| **P1** | P1-1 | `npm audit fix` (hono, ip-address, fast-uri, find-my-way) | XS |
| **P1** | P1-2 | Add Fastify `requestTimeout` / `connectionTimeout` | XS |
| **P1** | P1-3 | Add rate limiting via `@fastify/rate-limit` | S |
| **P2** | P2-1 | Extend SSRF filter with missing special-use ranges | S |
| **P2** | P2-2 | Sanitize Fastify default error handler | XS |
| **P2** | P2-3 | Add `max(500)` to `search_media` query | XS |
| **P2** | P2-4 | Apply `NUMERIC_ID` to `get_watch_history` section param | XS |
| **P3** | P3-1 | Pin Docker base image to digest | XS |
| **P3** | P3-2 | Add `@fastify/helmet` | XS |
| **P3** | P3-3 | Sync version strings from `package.json` | XS |
| **P3** | P3-4 | Allowlist `sort` parameter values | S |
| **P3** | P3-5 | DNS rebinding — document static-IP mitigation | — |
