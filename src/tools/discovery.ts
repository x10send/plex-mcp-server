import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type IPlexClient, PlexApiError } from "../plex-client.js";

interface MediaItem {
  ratingKey?: unknown;
  key?: unknown;
  title?: unknown;
  type?: unknown;
  year?: unknown;
  grandparentTitle?: unknown;
  parentTitle?: unknown;
  viewOffset?: unknown;
  duration?: unknown;
  viewedAt?: unknown;
}

interface PlexMediaContainer<T> {
  MediaContainer: T;
}

function msToTime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function formatItem(m: MediaItem): string {
  const key = m.ratingKey ?? m.key ?? "?";
  const title = String(m.title ?? "Unknown");
  const type = String(m.type ?? "?");
  const year = m.year ? ` (${m.year})` : "";
  const prefix = m.grandparentTitle
    ? `${m.grandparentTitle} › ${m.parentTitle ?? ""} › `
    : m.parentTitle
      ? `${m.parentTitle} › `
      : "";
  return `[${key}] ${prefix}${title}${year} [${type}]`;
}

function toolError(err: unknown): { content: [{ type: "text"; text: string }]; isError: true } {
  const msg =
    err instanceof PlexApiError
      ? `Plex API error ${err.status}: ${err.message.slice(0, 200)}`
      : "Unexpected error contacting Plex";
  return { content: [{ type: "text", text: msg }], isError: true };
}

export function registerDiscoveryTools(server: McpServer, client: IPlexClient): void {
  server.tool(
    "search_media",
    "Full-text search for movies, TV shows, episodes, or music across all Plex libraries.",
    {
      query: z.string().min(1).describe("Search query string"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max results to return (default 20)"),
    },
    async ({ query, limit = 20 }) => {
      try {
        const data = await client.get<PlexMediaContainer<{ Metadata?: MediaItem[] }>>("/search", {
          query,
          limit: String(limit),
        });
        const items = data.MediaContainer.Metadata ?? [];
        if (items.length === 0)
          return { content: [{ type: "text", text: `No results found for "${query}".` }] };
        const lines = items.map(formatItem);
        return {
          content: [
            {
              type: "text",
              text: `Search results for "${query}" (${items.length}):\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_genres",
    "List all genres present in a Plex library section. Use these values with get_library_contents genre filter.",
    {
      section_id: z.string().describe("Library section ID (from get_libraries)"),
    },
    async ({ section_id }) => {
      try {
        const data = await client.get<
          PlexMediaContainer<{
            Directory?: Array<{ title?: unknown; key?: unknown; size?: unknown }>;
          }>
        >(`/library/sections/${section_id}/genre`);
        const genres = data.MediaContainer.Directory ?? [];
        if (genres.length === 0)
          return { content: [{ type: "text", text: "No genres found in this library." }] };
        const lines = genres.map((g) => String(g.title ?? g.key ?? "?"));
        return {
          content: [{ type: "text", text: `Genres (${genres.length}):\n${lines.join("\n")}` }],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_actors",
    "List actors present in a Plex library section for filtering or browsing by cast.",
    {
      section_id: z.string().describe("Library section ID (from get_libraries)"),
    },
    async ({ section_id }) => {
      try {
        const data = await client.get<
          PlexMediaContainer<{ Directory?: Array<{ title?: unknown; key?: unknown }> }>
        >(`/library/sections/${section_id}/actor`);
        const actors = data.MediaContainer.Directory ?? [];
        if (actors.length === 0)
          return { content: [{ type: "text", text: "No actors found in this library." }] };
        const lines = actors.slice(0, 200).map((a) => String(a.title ?? a.key ?? "?"));
        return {
          content: [
            {
              type: "text",
              text: `Actors (showing ${lines.length} of ${actors.length}):\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_directors",
    "List directors present in a Plex library section for filtering or browsing by director.",
    {
      section_id: z.string().describe("Library section ID (from get_libraries)"),
    },
    async ({ section_id }) => {
      try {
        const data = await client.get<
          PlexMediaContainer<{ Directory?: Array<{ title?: unknown; key?: unknown }> }>
        >(`/library/sections/${section_id}/director`);
        const directors = data.MediaContainer.Directory ?? [];
        if (directors.length === 0)
          return { content: [{ type: "text", text: "No directors found in this library." }] };
        const lines = directors.slice(0, 200).map((d) => String(d.title ?? d.key ?? "?"));
        return {
          content: [
            {
              type: "text",
              text: `Directors (showing ${lines.length} of ${directors.length}):\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_collections",
    "List smart and manual collections in a Plex library section.",
    {
      section_id: z.string().describe("Library section ID (from get_libraries)"),
    },
    async ({ section_id }) => {
      try {
        const data = await client.get<
          PlexMediaContainer<{
            Metadata?: Array<{
              ratingKey?: unknown;
              title?: unknown;
              childCount?: unknown;
              type?: unknown;
            }>;
          }>
        >(`/library/sections/${section_id}/collections`);
        const collections = data.MediaContainer.Metadata ?? [];
        if (collections.length === 0)
          return { content: [{ type: "text", text: "No collections found in this library." }] };
        const lines = collections.map(
          (c) =>
            `[${c.ratingKey}] ${c.title ?? "Untitled"} — ${c.childCount ?? "?"} items [${c.type}]`
        );
        return {
          content: [
            { type: "text", text: `Collections (${collections.length}):\n${lines.join("\n")}` },
          ],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_collection_items",
    "List the media items inside a specific Plex collection.",
    {
      collection_id: z.string().describe("Rating key of the collection (from get_collections)"),
    },
    async ({ collection_id }) => {
      try {
        const data = await client.get<
          PlexMediaContainer<{ title?: string; Metadata?: MediaItem[] }>
        >(`/library/collections/${collection_id}/children`);
        const items = data.MediaContainer.Metadata ?? [];
        const title = data.MediaContainer.title ?? collection_id;
        if (items.length === 0)
          return { content: [{ type: "text", text: `No items found in collection "${title}".` }] };
        const lines = items.map(formatItem);
        return {
          content: [
            {
              type: "text",
              text: `Collection "${title}" (${items.length} items):\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_related",
    "Get Plex's related content for a media item — 'More by this director', 'Similar movies', etc. Primary tool for mood-based chained recommendations.",
    {
      rating_key: z.string().describe("Rating key of the media item"),
    },
    async ({ rating_key }) => {
      try {
        const data = await client.get<
          PlexMediaContainer<{
            Hub?: Array<{ title?: unknown; type?: unknown; Metadata?: MediaItem[] }>;
          }>
        >(`/library/metadata/${rating_key}/related`);
        const hubs = data.MediaContainer.Hub ?? [];
        if (hubs.length === 0)
          return { content: [{ type: "text", text: "No related content found." }] };
        const sections = hubs
          .filter((h) => (h.Metadata?.length ?? 0) > 0)
          .map((h) => {
            const items = (h.Metadata ?? []).slice(0, 10).map(formatItem);
            return `${h.title ?? h.type}:\n${items.map((i) => `  ${i}`).join("\n")}`;
          });
        return { content: [{ type: "text", text: sections.join("\n\n") }] };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_recently_added",
    "Get recently added media items across all libraries, or scoped to a specific section.",
    {
      section_id: z
        .string()
        .optional()
        .describe("Library section ID to scope results (optional — all libraries if omitted)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max items to return (default 20)"),
    },
    async ({ section_id, limit = 20 }) => {
      try {
        const path = section_id
          ? `/library/sections/${section_id}/recentlyAdded`
          : "/library/recentlyAdded";
        const data = await client.get<PlexMediaContainer<{ Metadata?: MediaItem[] }>>(path, {
          "X-Plex-Container-Size": String(limit),
        });
        const items = data.MediaContainer.Metadata ?? [];
        if (items.length === 0)
          return { content: [{ type: "text", text: "No recently added items found." }] };
        const lines = items.map(formatItem);
        return {
          content: [
            { type: "text", text: `Recently added (${items.length}):\n${lines.join("\n")}` },
          ],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_on_deck",
    "Get in-progress / continue-watching items with percent-watched progress.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max items to return (default 20)"),
    },
    async ({ limit = 20 }) => {
      try {
        const data = await client.get<PlexMediaContainer<{ Metadata?: MediaItem[] }>>(
          "/library/onDeck",
          {
            "X-Plex-Container-Size": String(limit),
          }
        );
        const items = data.MediaContainer.Metadata ?? [];
        if (items.length === 0)
          return { content: [{ type: "text", text: "No on-deck items found." }] };
        const lines = items.map((m) => {
          const pct =
            m.viewOffset && m.duration
              ? ` — ${Math.round((Number(m.viewOffset) / Number(m.duration)) * 100)}% watched (${msToTime(Number(m.viewOffset))} / ${msToTime(Number(m.duration))})`
              : "";
          return `${formatItem(m)}${pct}`;
        });
        return {
          content: [{ type: "text", text: `On deck (${items.length}):\n${lines.join("\n")}` }],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_watch_history",
    "Get playback history — what was watched, when, and how far. Use for 'have I seen this?' or 'what did I watch last week?' queries.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max history entries to return (default 30)"),
      account_id: z.number().int().optional().describe("Filter by Plex account ID (optional)"),
      library_section_id: z
        .number()
        .int()
        .optional()
        .describe("Filter by library section (optional)"),
    },
    async ({ limit = 30, account_id, library_section_id }) => {
      try {
        const params: Record<string, string> = { "X-Plex-Container-Size": String(limit) };
        if (account_id) params["accountID"] = String(account_id);
        if (library_section_id) params["librarySectionID"] = String(library_section_id);

        const data = await client.get<PlexMediaContainer<{ Metadata?: MediaItem[] }>>(
          "/status/sessions/history/all",
          params
        );
        const items = data.MediaContainer.Metadata ?? [];
        if (items.length === 0)
          return { content: [{ type: "text", text: "No watch history found." }] };
        const lines = items.map((m) => {
          const when = m.viewedAt
            ? new Date(Number(m.viewedAt) * 1000).toLocaleString()
            : "unknown time";
          return `${formatItem(m)} — watched ${when}`;
        });
        return {
          content: [
            { type: "text", text: `Watch history (${items.length}):\n${lines.join("\n")}` },
          ],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_random_items",
    "Get a random selection from a library section, with optional filters. Combine with genre/unwatched filters for discovery (e.g. random unwatched comedy).",
    {
      section_id: z.string().describe("Library section ID (from get_libraries)"),
      count: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Number of random items to return (default 5)"),
      genre: z.string().optional().describe("Filter by genre before randomising"),
      unwatched: z.boolean().optional().describe("If true, only select from unwatched items"),
      year: z.number().int().optional().describe("Filter by release year before randomising"),
    },
    async ({ section_id, count = 5, genre, unwatched, year }) => {
      try {
        const params: Record<string, string> = {
          "X-Plex-Container-Size": String(count),
          sort: "random",
        };
        if (genre) params["genre"] = genre;
        if (unwatched) params["unwatched"] = "1";
        if (year) params["year"] = String(year);

        const data = await client.get<PlexMediaContainer<{ Metadata?: MediaItem[] }>>(
          `/library/sections/${section_id}/all`,
          params
        );
        const items = data.MediaContainer.Metadata ?? [];
        if (items.length === 0)
          return { content: [{ type: "text", text: "No items found matching the criteria." }] };
        const lines = items.map(formatItem);
        return {
          content: [{ type: "text", text: `Random picks (${items.length}):\n${lines.join("\n")}` }],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );
}
