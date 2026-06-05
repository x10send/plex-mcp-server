import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type IPlexClient, PlexApiError } from "../plex-client.js";

interface PlexMediaPart {
  size?: unknown;
}

interface PlexMedia {
  videoResolution?: unknown;
  bitrate?: unknown;
  videoCodec?: unknown;
  audioCodec?: unknown;
  audioChannels?: unknown;
  container?: unknown;
  Part?: PlexMediaPart[];
}

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
  Media?: PlexMedia[];
}

interface PlexMediaContainer<T> {
  MediaContainer: T;
}

const CODEC_DISPLAY: Record<string, string> = {
  h264: "H.264",
  hevc: "HEVC (H.265)",
  mpeg4: "MPEG-4",
  mpeg2video: "MPEG-2",
  vp9: "VP9",
  av1: "AV1",
  aac: "AAC",
  ac3: "Dolby Digital",
  eac3: "Dolby Digital Plus",
  dca: "DTS",
  truehd: "TrueHD",
  mp3: "MP3",
  flac: "FLAC",
  opus: "Opus",
};

function displayCodec(codec: string): string {
  return CODEC_DISPLAY[codec.toLowerCase()] ?? codec.toUpperCase();
}

function formatResolution(r: unknown): string {
  const s = String(r).toLowerCase();
  if (s === "4k") return "4K";
  if (s === "1080") return "1080p";
  if (s === "720") return "720p";
  if (s === "480") return "480p";
  if (s === "sd") return "SD";
  return String(r);
}

function formatBitrate(kbps: number): string {
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function formatAudioChannels(ch: number): string {
  const map: Record<number, string> = { 1: "Mono", 2: "Stereo", 6: "5.1", 8: "7.1" };
  return map[ch] ?? `${ch} ch`;
}

function msToTime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function matchesResolutionFilter(videoResolution: unknown, filter: string): boolean {
  const r = String(videoResolution ?? "").toLowerCase();
  switch (filter) {
    case "4k":
      return r === "4k";
    case "1080p":
      return r === "1080";
    case "720p":
      return r === "720";
    case "sd":
      return r !== "4k" && r !== "1080" && r !== "720";
    default:
      return true;
  }
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

  const media = m.Media?.[0];
  const quality: string[] = [];
  if (media?.videoResolution) quality.push(formatResolution(media.videoResolution));
  if (media?.bitrate) quality.push(formatBitrate(Number(media.bitrate)));
  if (media?.videoCodec) quality.push(displayCodec(String(media.videoCodec)));
  const audioCodec = media?.audioCodec ? displayCodec(String(media.audioCodec)) : "";
  const audioChannels = media?.audioChannels
    ? formatAudioChannels(Number(media.audioChannels))
    : "";
  if (audioCodec || audioChannels)
    quality.push([audioCodec, audioChannels].filter(Boolean).join(" "));
  const part = media?.Part?.[0];
  if (part?.size) quality.push(formatFileSize(Number(part.size)));

  const qualitySuffix = quality.length > 0 ? ` | ${quality.join(" | ")}` : "";
  return `[${key}] ${prefix}${title}${year} [${type}]${qualitySuffix}`;
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

  const media = m.Media?.[0];
  if (media) {
    if (media.videoResolution) lines.push(`Resolution: ${formatResolution(media.videoResolution)}`);
    if (media.bitrate) lines.push(`Bitrate: ${formatBitrate(Number(media.bitrate))}`);
    if (media.videoCodec) lines.push(`Video Codec: ${displayCodec(String(media.videoCodec))}`);
    const audioCodec = media.audioCodec ? displayCodec(String(media.audioCodec)) : "";
    const audioChannels = media.audioChannels
      ? formatAudioChannels(Number(media.audioChannels))
      : "";
    if (audioCodec || audioChannels) {
      lines.push(`Audio: ${[audioCodec, audioChannels].filter(Boolean).join(" ")}`);
    }
    if (media.container) lines.push(`Container: ${String(media.container).toUpperCase()}`);
    const part = media.Part?.[0];
    if (part?.size) lines.push(`File Size: ${formatFileSize(Number(part.size))}`);
  }

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
    "List media items in a Plex library section with inline quality details (resolution, bitrate, codec). Supports filtering by genre, year, contentRating, studio, unwatched status, resolution, and minimum bitrate.",
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
      resolution: z
        .enum(["sd", "720p", "1080p", "4k"])
        .optional()
        .describe("Filter by video resolution: sd, 720p, 1080p, or 4k"),
      min_bitrate: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Filter to items with bitrate at or above this threshold (kbps)"),
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
      resolution,
      min_bitrate,
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
        // Push 4k/1080p/720p to server-side so totalSize reflects the filtered count
        // and pagination works over the filtered subset. SD stays client-side because
        // it means "not HD" and can't be expressed as a single videoResolution value.
        if (resolution === "4k") params["videoResolution"] = "4k";
        else if (resolution === "1080p") params["videoResolution"] = "1080";
        else if (resolution === "720p") params["videoResolution"] = "720";

        const data = await client.get<
          PlexMediaContainer<{ totalSize?: number; Metadata?: MediaItem[] }>
        >(`/library/sections/${section_id}/all`, params);
        let items = data.MediaContainer.Metadata ?? [];
        const total = data.MediaContainer.totalSize ?? items.length;

        // Client-side resolution guard: redundant for 4k/1080p/720p (server already filtered)
        // but necessary for sd ("not HD") which has no server-side equivalent.
        if (resolution !== undefined) {
          items = items.filter((item) => {
            const r = item.Media?.[0]?.videoResolution;
            return r !== undefined && matchesResolutionFilter(r, resolution);
          });
        }
        if (min_bitrate !== undefined) {
          items = items.filter((item) => {
            const b = item.Media?.[0]?.bitrate;
            return b !== undefined && Number(b) >= min_bitrate;
          });
        }

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
