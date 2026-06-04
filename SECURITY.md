# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| latest | Yes |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report security issues privately to: **security@x10send.com** (or open a [GitHub Security Advisory](https://github.com/x10send/plex-mcp-server/security/advisories/new)).

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix

We will acknowledge receipt within 48 hours and provide a timeline for a fix.

## Security Model

This server is a **trusted LAN bridge**. It is designed to run on a private network behind [`mcp-edge-gateway`](https://github.com/x10send/mcp-edge-gateway), which handles all external authentication and access control.

**What this server does:**
- Exposes Plex library data to AI assistants via MCP
- Validates the Plex token per-request (header or env var)
- Prevents SSRF by rejecting `PLEX_URL` values pointing to public IPs

**What this server does NOT do:**
- Authenticate incoming MCP requests (that is the gateway's job)
- Expose any admin, write (except DVR scheduling in Phase 3), or destructive Plex APIs
- Log the Plex token (it is redacted in all log output)
- Make outbound calls to any host other than `PLEX_URL`

**Do not expose this server directly to the internet.** Run it behind `mcp-edge-gateway`.

## Known Scope Limitations

- The server trusts the `X-Plex-Token` header from its caller. On a LAN where anything can reach the container port, a caller could supply an arbitrary (but valid) Plex token. Plex validates tokens server-side, so an invalid token is rejected by Plex. Restrict container port access to the gateway host.
- SSRF protection covers literal IPs and resolvable hostnames at startup; it does not protect against DNS rebinding attacks. Use `PLEX_URL` with a static LAN IP rather than a hostname if this is a concern.
