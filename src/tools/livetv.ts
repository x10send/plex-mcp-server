import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type IPlexClient, PlexApiError } from "../plex-client.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface EpgMedia {
  channelCallSign?: unknown;
  channelID?: unknown;
  channelKey?: unknown;
  startsAt?: unknown; // unix seconds
  endsAt?: unknown; // unix seconds
}

interface EpgProgram {
  ratingKey?: unknown;
  title?: unknown;
  type?: unknown;
  year?: unknown;
  summary?: unknown;
  contentRating?: unknown;
  rating?: unknown;
  grandparentTitle?: unknown; // show name for episodes
  parentTitle?: unknown; // season label
  parentIndex?: unknown; // season number
  index?: unknown; // episode number
  Genre?: Array<{ tag?: unknown }>;
  Media?: EpgMedia[];
}

interface EpgFeature {
  key?: unknown;
  type?: unknown;
}

interface MediaProvider {
  identifier?: unknown;
  Feature?: EpgFeature[];
}

interface ProvidersResponse {
  MediaContainer: { MediaProvider?: MediaProvider[] };
}

interface GuideResponse {
  MediaContainer: { Metadata?: EpgProgram[] };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseTimestamp(val: string | undefined): number | undefined {
  if (!val) return undefined;
  if (/^\d+$/.test(val)) return parseInt(val, 10) * 1000;
  const d = new Date(val);
  return isNaN(d.getTime()) ? undefined : d.getTime();
}

function formatTime(epochMs: number): string {
  const d = new Date(epochMs);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}, ${h12}:${m} ${ampm}`;
}

function formatProgram(p: EpgProgram): string {
  const title = String(p.title ?? "Unknown");
  const type = String(p.type ?? "?");
  const year = p.year ? ` (${p.year})` : "";
  const rating = p.rating ? ` | ★${Number(p.rating).toFixed(1)}` : "";
  const contentRating = p.contentRating ? ` | ${p.contentRating}` : "";

  const episodePrefix = p.grandparentTitle
    ? `${p.grandparentTitle}` +
      (p.parentIndex !== undefined ? ` S${p.parentIndex}` : "") +
      (p.index !== undefined ? `E${p.index}` : "") +
      ": "
    : "";

  const genres = (p.Genre ?? [])
    .map((g) => String(g.tag ?? ""))
    .filter(Boolean)
    .join(", ");

  const media = p.Media?.[0];
  const channel = media?.channelCallSign ? `  Channel: ${media.channelCallSign}` : "";
  const channelKey = media?.channelKey ? `\n  Channel ID: ${String(media.channelKey)}` : "";
  const startsMs = media?.startsAt !== undefined ? Number(media.startsAt) * 1000 : undefined;
  const endsMs = media?.endsAt !== undefined ? Number(media.endsAt) * 1000 : undefined;
  const timeRange =
    startsMs !== undefined
      ? `\n  Airs: ${formatTime(startsMs)}${endsMs !== undefined ? ` → ${formatTime(endsMs)}` : ""}`
      : "";

  const summary = p.summary ? `\n  ${String(p.summary).slice(0, 200)}` : "";
  const genreLine = genres ? `\n  Genre: ${genres}` : "";
  const programId = p.ratingKey ? `\n  Program ID: ${p.ratingKey}` : "";

  return (
    `${episodePrefix}${title}${year} [${type}]${rating}${contentRating}\n` +
    `${channel}${channelKey}${timeRange}${genreLine}${summary}${programId}`
  );
}

function toolError(err: unknown): { content: [{ type: "text"; text: string }]; isError: true } {
  const msg =
    err instanceof PlexApiError
      ? `Plex API error ${err.status}: ${err.message.slice(0, 200)}`
      : "Unexpected error contacting Plex";
  return { content: [{ type: "text", text: msg }], isError: true };
}

const NOT_CONFIGURED =
  "Live TV / DVR is not configured on this Plex server. " +
  "Set up a tuner and DVR in Plex settings to access the guide.";

// ── Tool registration ────────────────────────────────────────────────────────

export function registerLiveTvTools(server: McpServer, client: IPlexClient): void {
  server.tool(
    "get_live_tv_guide",
    [
      "Browse the Plex Live TV program guide. Supports flexible time windows, channel filtering, title search, content-type filtering, and genre filtering.",
      "Default window is now → next 4 hours. Extend up to 7 days (hours=168) for movie hunting.",
      "Returns channel, air times, rating, genre, summary, and Program ID needed to schedule a DVR recording.",
    ].join(" "),
    {
      channel_id: z
        .string()
        .optional()
        .describe(
          "Plex channel key to restrict results to one channel (e.g. /livetv/channels/abc123)"
        ),
      start: z
        .string()
        .optional()
        .describe("Guide start as Unix timestamp (seconds) or ISO 8601. Defaults to now."),
      end: z
        .string()
        .optional()
        .describe("Guide end as Unix timestamp (seconds) or ISO 8601. Overrides hours."),
      hours: z
        .number()
        .min(1)
        .max(168)
        .optional()
        .describe("Hours from start to include (1–168). Ignored when end is set. Defaults to 4."),
      query: z
        .string()
        .optional()
        .describe("Title search — case-insensitive substring match against program or show title"),
      type: z
        .enum(["movie", "episode"])
        .optional()
        .describe("Filter by content type: movie or episode"),
      genre: z
        .string()
        .optional()
        .describe(
          "Filter by genre — case-insensitive substring match (e.g. 'adventure', 'action')"
        ),
    },
    async (args) => {
      const nowMs = Date.now();
      const startMs = parseTimestamp(args.start) ?? nowMs;
      const hours = args.hours ?? 4;
      const endMs = parseTimestamp(args.end) ?? startMs + hours * 3600 * 1000;

      try {
        // Discover EPG provider — also confirms Live TV is configured
        let providers: ProvidersResponse;
        try {
          providers = await client.get<ProvidersResponse>("/media/providers");
        } catch {
          return { content: [{ type: "text", text: NOT_CONFIGURED }] };
        }

        const epgProvider = (providers.MediaContainer?.MediaProvider ?? []).find((p) =>
          String(p.identifier ?? "").includes("epg")
        );

        if (!epgProvider) {
          return { content: [{ type: "text", text: NOT_CONFIGURED }] };
        }

        // Prefer the guide feature's declared path; fall back to provider-derived path.
        // Plex uses type "guide" or "content" for the EPG items feature.
        const guideFeature = (epgProvider.Feature ?? []).find(
          (f) =>
            String(f.type ?? "")
              .toLowerCase()
              .includes("guide") ||
            String(f.type ?? "").toLowerCase() === "content" ||
            String(f.key ?? "")
              .toLowerCase()
              .includes("items") ||
            String(f.key ?? "")
              .toLowerCase()
              .includes("guide")
        );
        const providerId = String(epgProvider.identifier ?? "tv.plex.provider.epg");
        const guidePath = guideFeature?.key
          ? String(guideFeature.key)
          : `/media/providers/${providerId}/items`;

        // Plex type codes: 1 = movie, 4 = episode
        const params: Record<string, string> = {
          startDate: Math.floor(startMs / 1000).toString(),
          stopDate: Math.floor(endMs / 1000).toString(),
        };
        if (args.channel_id) params.channelKey = args.channel_id;
        if (args.type === "movie") params.type = "1";
        else if (args.type === "episode") params.type = "4";

        let guide: GuideResponse;
        try {
          guide = await client.get<GuideResponse>(guidePath, params);
        } catch (guideErr) {
          if (guideErr instanceof PlexApiError && guideErr.status === 404) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    `Live TV guide returned 404 on path "${guidePath}". ` +
                    `EPG provider: ${providerId}. ` +
                    `Feature key used: ${guideFeature?.key ?? "none (used fallback)"}. ` +
                    `Run: curl -s -H "X-Plex-Token: YOUR_TOKEN" ` +
                    `http://YOUR_PLEX_URL/media/providers to inspect available guide paths.`,
                },
              ],
              isError: true,
            };
          }
          return toolError(guideErr);
        }
        let programs = guide.MediaContainer?.Metadata ?? [];

        // Client-side filters (Plex may not support all server-side)
        if (args.query) {
          const q = args.query.toLowerCase();
          programs = programs.filter((p) => {
            const title = String(p.title ?? "").toLowerCase();
            const show = String(p.grandparentTitle ?? "").toLowerCase();
            return title.includes(q) || show.includes(q);
          });
        }
        if (args.genre) {
          const g = args.genre.toLowerCase();
          programs = programs.filter((p) =>
            (p.Genre ?? []).some((genre) =>
              String(genre.tag ?? "")
                .toLowerCase()
                .includes(g)
            )
          );
        }

        if (programs.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No programs found matching your criteria in the requested time window.",
              },
            ],
          };
        }

        // Sort by air time
        programs.sort((a, b) => {
          const aTime = Number(a.Media?.[0]?.startsAt ?? 0);
          const bTime = Number(b.Media?.[0]?.startsAt ?? 0);
          return aTime - bTime;
        });

        const window = `${formatTime(startMs)} → ${formatTime(endMs)}`;
        const header = `Guide: ${programs.length} program${programs.length === 1 ? "" : "s"} (${window})\n\n`;
        const body = programs.map((p) => formatProgram(p)).join("\n\n");

        return { content: [{ type: "text", text: header + body }] };
      } catch (err) {
        return toolError(err);
      }
    }
  );
}
