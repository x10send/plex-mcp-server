# plex-mcp-server

MCP server for Plex Media Server. Lets AI assistants browse your libraries, search media, get viewing recommendations, check what's on deck, and more — all read-only against your local Plex instance.

Distributed as a Docker image via GHCR. Designed to run behind [mcp-edge-gateway](https://github.com/x10send/mcp-edge-gateway) for OAuth-secured remote access.

## Tools

**Library**
- `get_libraries` — list all library sections
- `get_library_contents` — paginated contents of a section (filter by genre, year, content rating, studio, watched status)
- `get_children` — seasons of a show, episodes of a season, tracks of an album
- `get_media_info` — full metadata for any item
- `get_media_extras` — trailers, behind-the-scenes, and other extras

**Discovery**
- `search_media` — full-text search across all libraries
- `get_genres` / `get_actors` / `get_directors` — browse by taxonomy
- `get_collections` / `get_collection_items` — named collections
- `get_related` — Plex's related-content hubs for an item
- `get_recently_added` — new additions across all libraries or a specific section
- `get_on_deck` — in-progress items with watch percentage
- `get_watch_history` — recently watched with timestamps
- `get_random_items` — random picks from a section (optionally filtered)

## Quick start

```bash
docker run --rm \
  -e PLEX_URL=http://192.168.1.x:32400 \
  -e PLEX_TOKEN=your-token \
  -p 3003:3000 \
  ghcr.io/x10send/plex-mcp-server:latest
```

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `PLEX_URL` | Yes | — | Local Plex URL, e.g. `http://192.168.1.10:32400` |
| `PLEX_TOKEN` | No | — | Plex auth token (can be injected per-request by the gateway instead) |
| `MCP_PORT` | No | `3000` | Port to listen on |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, or `error` |

`PLEX_TOKEN` is optional at startup — the server also accepts it per-request via the `X-Plex-Token` header. The header takes priority over the env var. If neither is present, the server returns 401.

## Gateway integration

When running behind mcp-edge-gateway, store your token as `PLEX_TOKEN` in the gateway's upstream config. The gateway injects it as `X-Plex-Token` on each request. No token needed in the server's environment.

## Development

```bash
npm ci
npm run dev       # hot-reload dev server
npm run check     # format → lint → typecheck → test+coverage → build
npm test          # tests only
```

Coverage thresholds: ≥85% lines/functions, ≥70% branches.

## Security

See [SECURITY.md](SECURITY.md). This server is designed for LAN/gateway use only — do not expose it directly to the internet.

## License

MIT — see [LICENSE](LICENSE).
