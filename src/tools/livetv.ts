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
  key?: unknown; // full metadata path, e.g. /library/metadata/12345 — used as programKey for DVR
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
  title?: unknown;
  type?: unknown;
  Feature?: EpgFeature[];
  [key: string]: unknown;
}

interface ProvidersResponse {
  MediaContainer: { MediaProvider?: MediaProvider[]; [key: string]: unknown };
}

interface GuideResponse {
  MediaContainer: { Metadata?: EpgProgram[]; [key: string]: unknown };
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
  const startsMs = media?.startsAt !== undefined ? Number(media.startsAt) * 1000 : undefined;
  const endsMs = media?.endsAt !== undefined ? Number(media.endsAt) * 1000 : undefined;
  // Prefer the full key path (what Plex needs as programKey for DVR scheduling)
  const programId = p.key ?? p.ratingKey;

  const details = [
    media?.channelCallSign ? `  Channel: ${media.channelCallSign}` : "",
    media?.channelKey ? `  Channel ID: ${String(media.channelKey)}` : "",
    startsMs !== undefined
      ? `  Airs: ${formatTime(startsMs)}${endsMs !== undefined ? ` → ${formatTime(endsMs)}` : ""}`
      : "",
    genres ? `  Genre: ${genres}` : "",
    p.summary ? `  ${String(p.summary).slice(0, 200)}` : "",
    programId ? `  Program ID: ${programId}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    `${episodePrefix}${title}${year} [${type}]${rating}${contentRating}` +
    (details ? `\n${details}` : "")
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
      debug: z
        .boolean()
        .optional()
        .describe(
          "Return raw diagnostic data (provider list, exact params, raw guide response) instead of formatted programs. Use when the guide returns empty results to diagnose what Plex is sending back."
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

        const epgProviders = (providers.MediaContainer?.MediaProvider ?? []).filter((p) =>
          String(p.identifier ?? "").includes("epg")
        );

        if (epgProviders.length === 0) {
          return { content: [{ type: "text", text: NOT_CONFIGURED }] };
        }

        // Plex type codes: 1 = movie, 4 = episode
        const params: Record<string, string> = {
          gridStart: Math.floor(startMs / 1000).toString(),
          gridEnd: Math.floor(endMs / 1000).toString(),
        };
        if (args.channel_id) params.channelKey = args.channel_id;
        if (args.type === "movie") params.type = "1";
        else if (args.type === "episode") params.type = "4";

        let programs: EpgProgram[] = [];
        const triedPaths: string[] = [];
        let anySucceeded = false;

        // debug mode: collect raw provider and response data for diagnosis
        const debugLines: string[] = [];
        if (args.debug) {
          debugLines.push(`=== EPG Debug Report ===`);
          debugLines.push(`\n-- /media/providers: ${epgProviders.length} EPG provider(s) --`);
          for (const p of epgProviders) {
            debugLines.push(
              `  identifier: ${p.identifier}  title: ${p.title ?? "(none)"}  type: ${p.type ?? "(none)"}`
            );
            for (const f of p.Feature ?? []) {
              debugLines.push(
                `    feature  type: ${f.type ?? "(none)"}  key: ${f.key ?? "(none)"}`
              );
            }
            const otherKeys = Object.keys(p).filter(
              (k) => !["identifier", "title", "type", "Feature"].includes(k)
            );
            if (otherKeys.length) debugLines.push(`    other keys: ${otherKeys.join(", ")}`);
          }
          debugLines.push(`\n-- Grid params --`);
          debugLines.push(`  ${JSON.stringify(params)}`);
        }

        for (const epgProvider of epgProviders) {
          // Plex cloud EPG uses type "grid" with gridStart/gridEnd params.
          // Older/local EPG may use type "guide". "content" and "items" features
          // lead to section-list endpoints, not guide data — skip them.
          const guideFeature = (epgProvider.Feature ?? []).find(
            (f) =>
              String(f.type ?? "").toLowerCase() === "grid" ||
              String(f.key ?? "")
                .toLowerCase()
                .includes("/grid") ||
              String(f.type ?? "")
                .toLowerCase()
                .includes("guide") ||
              String(f.key ?? "")
                .toLowerCase()
                .includes("guide")
          );
          const providerId = String(epgProvider.identifier ?? "tv.plex.provider.epg");
          const guidePath = guideFeature?.key ? String(guideFeature.key) : `/${providerId}/grid`;
          triedPaths.push(guidePath);

          try {
            const guide = await client.get<GuideResponse>(guidePath, params);
            anySucceeded = true;
            const results = guide.MediaContainer?.Metadata ?? [];
            if (args.debug) {
              debugLines.push(`\n-- ${guidePath} → 200 OK --`);
              const containerKeys = Object.keys(guide.MediaContainer ?? {});
              debugLines.push(`  MediaContainer keys: ${containerKeys.join(", ")}`);
              debugLines.push(`  Metadata count: ${results.length}`);
              // Dump full raw container (truncated) so we can see what fields Plex returns
              const raw = JSON.stringify(guide.MediaContainer).slice(0, 2000);
              debugLines.push(`  Raw (first 2000 chars):\n${raw}`);
            }
            if (results.length > 0) {
              programs = results;
              if (!args.debug) break;
            }
          } catch (guideErr) {
            if (guideErr instanceof PlexApiError && guideErr.status === 404) {
              if (args.debug) debugLines.push(`\n-- ${guidePath} → 404 Not Found --`);
              continue;
            }
            return toolError(guideErr);
          }
        }

        if (args.debug) {
          return { content: [{ type: "text", text: debugLines.join("\n") }] };
        }

        if (!anySucceeded) {
          return {
            content: [
              {
                type: "text",
                text:
                  `Live TV guide returned 404 on all EPG provider paths. ` +
                  `Tried: ${triedPaths.join(", ")}. ` +
                  `Run: curl -s -H "X-Plex-Token: YOUR_TOKEN" ` +
                  `http://YOUR_PLEX_URL/media/providers to inspect available guide paths.`,
              },
            ],
            isError: true,
          };
        }

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
                text:
                  "No programs found matching your criteria in the requested time window.\n" +
                  `Searched: ${formatTime(startMs)} → ${formatTime(endMs)}\n` +
                  `Guide paths tried: ${triedPaths.join(", ")}\n` +
                  "If the guide appears empty, try refreshing EPG data in Plex (Settings → Live TV & DVR → Refresh Guide Data).",
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
