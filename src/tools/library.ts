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
  index?: unknown;
  summary?: unknown;
  rating?: unknown;
  duration?: unknown;
  studio?: unknown;
  contentRating?: unknown;
  viewCount?: unknown;
  viewOffset?: unknown;
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

function formatDetail(m: MediaItem): string {
  const lines: string[] = [
    `Title: ${m.title ?? "Unknown"}`,
    `Type: ${m.type ?? "?"}`,
    `Rating Key: ${m.ratingKey ?? "?"}`,
  ];
  if (m.year) lines.push(`Year: ${m.year}`);
  if (m.summary) lines.push(`Summary: ${String(m.summary).slice(0, 400)}`);
  if (m.rating) lines.push(`Rating: ${m.rating}`);
  if (m.duration) lines.push(`Duration: ${msToTime(Number(m.duration))}`);
  if (m.studio) lines.push(`Studio: ${m.studio}`);
  if (m.contentRating) lines.push(`Content Rating: ${m.contentRating}`);
  if (m.grandparentTitle) lines.push(`Show: ${m.grandparentTitle}`);
  if (m.parentTitle) lines.push(`Season: ${m.parentTitle}`);
  if (m.index) lines.push(`Episode/Track: ${m.index}`);
  if (m.viewCount) lines.push(`Play Count: ${m.viewCount}`);
  return lines.join("\n");
}

function toolError(err: unknown): { content: [{ type: "text"; text: string }]; isError: true } {
  const msg =
    err instanceof PlexApiError
      ? `Plex API error ${err.status}: ${err.message.slice(0, 200)}`
      : "Unexpected error contacting Plex";
  return { content: [{ type: "text", text: msg }], isError: true };
}

export function registerLibraryTools(server: McpServer, client: IPlexClient): void {
  server.tool(
    "get_libraries",
    "List all Plex library sections with their IDs, types, and item counts.",
    {},
    async () => {
      try {
        const data =
          await client.get<PlexMediaContainer<{ Directory?: MediaItem[] }>>("/library/sections");
        const sections = data.MediaContainer.Directory ?? [];
        if (sections.length === 0)
          return { content: [{ type: "text", text: "No libraries found." }] };
        const lines = sections.map((s) => {
          const d = s as Record<string, unknown>;
          return `[${d["key"]}] ${d["title"]} — type: ${d["type"]}, items: ${d["count"] ?? "?"}`;
        });
        return {
          content: [{ type: "text", text: `Libraries (${sections.length}):\n${lines.join("\n")}` }],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_library_contents",
    "List media items in a Plex library section. Supports filtering by genre, year, contentRating, studio, and unwatched status.",
    {
      section_id: z.string().describe("Library section ID (from get_libraries)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max items to return (default 50)"),
      offset: z.number().int().min(0).optional().describe("Pagination offset (default 0)"),
      genre: z
        .string()
        .optional()
        .describe("Filter by genre name (use get_genres to discover valid values)"),
      unwatched: z.boolean().optional().describe("If true, return only unwatched items"),
      year: z.number().int().optional().describe("Filter by release year"),
      content_rating: z
        .string()
        .optional()
        .describe("Filter by content rating (e.g. PG-13, TV-MA)"),
      studio: z.string().optional().describe("Filter by studio name"),
      sort: z.string().optional().describe("Sort order (e.g. title, year, rating, addedAt)"),
    },
    async ({
      section_id,
      limit = 50,
      offset = 0,
      genre,
      unwatched,
      year,
      content_rating,
      studio,
      sort,
    }) => {
      try {
        const params: Record<string, string> = {
          "X-Plex-Container-Size": String(limit),
          "X-Plex-Container-Start": String(offset),
        };
        if (genre) params["genre"] = genre;
        if (unwatched) params["unwatched"] = "1";
        if (year) params["year"] = String(year);
        if (content_rating) params["contentRating"] = content_rating;
        if (studio) params["studio"] = studio;
        if (sort) params["sort"] = sort;

        const data = await client.get<
          PlexMediaContainer<{ totalSize?: number; Metadata?: MediaItem[] }>
        >(`/library/sections/${section_id}/all`, params);
        const items = data.MediaContainer.Metadata ?? [];
        const total = data.MediaContainer.totalSize ?? items.length;
        if (items.length === 0)
          return { content: [{ type: "text", text: "No items found matching the criteria." }] };
        const lines = items.map(formatItem);
        return {
          content: [
            {
              type: "text",
              text: `Library contents (${offset}–${offset + items.length} of ${total}):\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_children",
    "Drill into a show's seasons, a season's episodes, or an album's tracks by rating key.",
    {
      rating_key: z.string().describe("Rating key of the parent item (show, season, or album)"),
    },
    async ({ rating_key }) => {
      try {
        const data = await client.get<
          PlexMediaContainer<{ title?: string; Metadata?: MediaItem[] }>
        >(`/library/metadata/${rating_key}/children`);
        const items = data.MediaContainer.Metadata ?? [];
        const parentTitle = data.MediaContainer.title ?? rating_key;
        if (items.length === 0)
          return { content: [{ type: "text", text: `No children found for "${parentTitle}".` }] };
        const lines = items.map(formatItem);
        return {
          content: [
            {
              type: "text",
              text: `Children of "${parentTitle}" (${items.length}):\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_media_info",
    "Get full metadata for a single media item by its Plex rating key.",
    {
      rating_key: z.string().describe("Plex rating key (item ID) of the media item"),
    },
    async ({ rating_key }) => {
      try {
        const data = await client.get<PlexMediaContainer<{ Metadata?: MediaItem[] }>>(
          `/library/metadata/${rating_key}`
        );
        const item = data.MediaContainer.Metadata?.[0];
        if (!item)
          return {
            content: [{ type: "text", text: `No media found for rating key ${rating_key}.` }],
          };
        return { content: [{ type: "text", text: formatDetail(item) }] };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_media_extras",
    "Get trailers, featurettes, interviews, and other extras attached to a media item.",
    {
      rating_key: z.string().describe("Rating key of the media item"),
    },
    async ({ rating_key }) => {
      try {
        const data = await client.get<PlexMediaContainer<{ Metadata?: MediaItem[] }>>(
          `/library/metadata/${rating_key}/extras`
        );
        const items = data.MediaContainer.Metadata ?? [];
        if (items.length === 0)
          return { content: [{ type: "text", text: "No extras found for this item." }] };
        const lines = items.map(formatItem);
        return {
          content: [{ type: "text", text: `Extras (${items.length}):\n${lines.join("\n")}` }],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );
}
