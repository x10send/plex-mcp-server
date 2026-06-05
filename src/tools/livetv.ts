import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type IPlexClient, PlexApiError } from "../plex-client.js";
import { toolError } from "./shared.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface EpgMedia {
  channelCallSign?: unknown;
  channelIdentifier?: unknown;
  channelVcn?: unknown;
  channelTitle?: unknown;
  gridKey?: unknown;
  beginsAt?: unknown; // unix seconds
  endsAt?: unknown; // unix seconds
  duration?: unknown; // milliseconds
}

interface EpgProgram {
  ratingKey?: unknown;
  key?: unknown;
  title?: unknown;
  type?: unknown;
  year?: unknown;
  summary?: unknown;
  contentRating?: unknown;
  rating?: unknown;
  grandparentTitle?: unknown;
  parentTitle?: unknown;
  parentIndex?: unknown;
  index?: unknown;
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

interface ChannelGroup {
  vcnNum: number;
  vcn: string;
  title: string;
  id: string;
  programs: EpgProgram[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseTimestamp(val: string | undefined): number | undefined {
  if (!val) return undefined;
  if (/^\d+$/.test(val)) return parseInt(val, 10) * 1000;
  const d = new Date(val);
  return isNaN(d.getTime()) ? undefined : d.getTime();
}

// Full date + time for the guide window header.
function formatDateTime(epochMs: number): string {
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

// Short time-only for per-program listings within a channel group.
function formatTimeShort(epochMs: number): string {
  const d = new Date(epochMs);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function formatProgram(p: EpgProgram): string {
  const media = p.Media![0];
  const startsMs = Number(media.beginsAt) * 1000;
  const endsMs = Number(media.endsAt) * 1000;
  const durMs = Number(media.duration ?? 0);
  const durMin = durMs > 0 ? ` (${Math.round(durMs / 60000)} min)` : "";

  const showName = p.grandparentTitle ? String(p.grandparentTitle) : null;
  const epTitle = String(p.title ?? "Unknown");
  let displayTitle: string;
  if (showName && showName !== epTitle) {
    const season = p.parentIndex !== undefined ? `S${p.parentIndex}` : "";
    const ep = p.index !== undefined ? `E${p.index}` : "";
    const seEp = season || ep ? ` ${season}${ep}` : "";
    displayTitle = `${showName}${seEp}: ${epTitle}`;
  } else {
    displayTitle = epTitle;
  }

  const year = p.year ? ` (${p.year})` : "";
  const cr = p.contentRating ? ` [${p.contentRating}]` : "";
  const rating = p.rating ? ` ★${Number(p.rating).toFixed(1)}` : "";
  const genres = (Array.isArray(p.Genre) ? p.Genre : [])
    .map((g) => String(g.tag ?? ""))
    .filter(Boolean)
    .join("/");
  const genreStr = genres ? ` | ${genres}` : "";
  const progId = String(p.ratingKey ?? p.key ?? "?");
  const timeStr = `${formatTimeShort(startsMs)} – ${formatTimeShort(endsMs)}`;
  // For scheduling: use the show name for episodes (grandparentTitle), movie title for movies.
  const recordTitle = showName ?? epTitle;
  const progType = String(p.type ?? "movie");

  return (
    `  ${timeStr}  ${displayTitle}${year}${durMin}${cr}${rating}${genreStr}\n` +
    `    program_id: ${progId}\n` +
    `    program_title: ${recordTitle}\n` +
    `    program_type: ${progType}`
  );
}

function groupByChannel(programs: EpgProgram[]): ChannelGroup[] {
  const map = new Map<string, ChannelGroup>();
  for (const p of programs) {
    const media = p.Media?.[0];
    if (!media) continue;
    const id = String(media.channelIdentifier ?? media.channelCallSign ?? "unknown");
    const vcn = String(media.channelVcn ?? "");
    const title = String(media.channelTitle ?? media.channelCallSign ?? "Unknown Channel");
    if (!map.has(id)) {
      map.set(id, { vcnNum: parseFloat(vcn) || 0, vcn, title, id, programs: [] });
    }
    map.get(id)!.programs.push(p);
  }
  const channels = [...map.values()].sort(
    (a, b) => a.vcnNum - b.vcnNum || a.vcn.localeCompare(b.vcn) || a.title.localeCompare(b.title)
  );
  for (const ch of channels) {
    ch.programs.sort(
      (a, b) => Number(a.Media?.[0]?.beginsAt ?? 0) - Number(b.Media?.[0]?.beginsAt ?? 0)
    );
  }
  return channels;
}

const NOT_CONFIGURED =
  "Live TV / DVR is not configured on this Plex server. " +
  "Set up a tuner and DVR in Plex settings to access the guide.";

// ── Tool registration ────────────────────────────────────────────────────────

export function registerLiveTvTools(server: McpServer, client: IPlexClient): void {
  server.tool(
    "get_live_tv_guide",
    [
      "Browse the Plex Live TV program guide grouped by channel.",
      "Default window is now → next 4 hours. Extend up to 7 days (hours=168) for movie hunting.",
      "Returns program_id and channel_id needed to call schedule_recording directly.",
    ].join(" "),
    {
      channel_id: z
        .string()
        .optional()
        .describe(
          "Filter to one channel — pass the channel_id value from a previous guide result (the channelIdentifier field)"
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
        .union([z.boolean(), z.string().transform((v) => v === "true")])
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
        let providers: ProvidersResponse;
        try {
          providers = await client.get<ProvidersResponse>("/media/providers");
        } catch {
          return { content: [{ type: "text", text: NOT_CONFIGURED }] };
        }

        const epgProviders = (
          Array.isArray(providers.MediaContainer?.MediaProvider)
            ? providers.MediaContainer.MediaProvider
            : []
        ).filter((p) => String(p.identifier ?? "").includes("epg"));

        if (epgProviders.length === 0) {
          return { content: [{ type: "text", text: NOT_CONFIGURED }] };
        }

        // Plex EPG grid uses comparison-operator params: beginsAt< and endsAt>
        // (URL-encoded as beginsAt%3C and endsAt%3E on the wire).
        // Standard interval-overlap query: programs where beginsAt < windowEnd AND endsAt > windowStart.
        // gridStart/gridEnd are silently ignored by the cloud EPG and return empty results.
        // type and channelKey server params are not reliably supported — filter client-side.
        const params: Record<string, string> = {
          "beginsAt<": Math.floor(endMs / 1000).toString(),
          "endsAt>": Math.floor(startMs / 1000).toString(),
        };

        let programs: EpgProgram[] = [];
        const triedPaths: string[] = [];
        let anySucceeded = false;

        const debugLines: string[] = [];
        if (args.debug) {
          debugLines.push(`=== EPG Debug Report ===`);
          debugLines.push(`\n-- /media/providers: ${epgProviders.length} EPG provider(s) --`);
          for (const p of epgProviders) {
            debugLines.push(
              `  identifier: ${p.identifier}  title: ${p.title ?? "(none)"}  type: ${p.type ?? "(none)"}`
            );
            for (const f of Array.isArray(p.Feature) ? p.Feature : []) {
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
          const guideFeature = (Array.isArray(epgProvider.Feature) ? epgProvider.Feature : []).find(
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
            const container = guide?.MediaContainer;
            const rawMetadata = container?.Metadata;
            const results = Array.isArray(rawMetadata) ? rawMetadata : [];
            if (args.debug) {
              debugLines.push(`\n-- ${guidePath} → 200 OK --`);
              const containerKeys = Object.keys(container ?? {});
              debugLines.push(`  MediaContainer keys: ${containerKeys.join(", ")}`);
              debugLines.push(`  Metadata count: ${results.length}`);
              const raw = (JSON.stringify(container ?? null) ?? "null").slice(0, 2000);
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

        // Drop items with no Media — they have no air time and cannot be scheduled.
        programs = programs.filter((p) => p.Media && p.Media.length > 0);

        // All filters are client-side — the cloud EPG grid returns the full set
        // and does not reliably honour server-side type/channel params.
        if (args.query) {
          const q = args.query.toLowerCase();
          programs = programs.filter((p) => {
            const title = String(p.title ?? "").toLowerCase();
            const show = String(p.grandparentTitle ?? "").toLowerCase();
            return title.includes(q) || show.includes(q);
          });
        }
        if (args.type) {
          programs = programs.filter((p) => String(p.type ?? "") === args.type);
        }
        if (args.genre) {
          const g = args.genre.toLowerCase();
          programs = programs.filter((p) =>
            (Array.isArray(p.Genre) ? p.Genre : []).some((genre) =>
              String(genre.tag ?? "")
                .toLowerCase()
                .includes(g)
            )
          );
        }
        if (args.channel_id) {
          programs = programs.filter((p) => {
            const media = p.Media?.[0];
            return (
              String(media?.channelIdentifier ?? "") === args.channel_id ||
              String(media?.gridKey ?? "") === args.channel_id
            );
          });
        }

        if (programs.length === 0) {
          return {
            content: [
              {
                type: "text",
                text:
                  "No programs found matching your criteria in the requested time window.\n" +
                  `Searched: ${formatDateTime(startMs)} → ${formatDateTime(endMs)}\n` +
                  `Guide paths tried: ${triedPaths.join(", ")}\n` +
                  "If the guide appears empty, try refreshing EPG data in Plex (Settings → Live TV & DVR → Refresh Guide Data).",
              },
            ],
          };
        }

        const channels = groupByChannel(programs);
        const totalPrograms = channels.reduce((n, ch) => n + ch.programs.length, 0);
        const window = `${formatDateTime(startMs)} → ${formatDateTime(endMs)}`;
        const headerLine = `Guide: ${totalPrograms} program${totalPrograms !== 1 ? "s" : ""} on ${channels.length} channel${channels.length !== 1 ? "s" : ""} (${window})\n\n`;

        const body = channels
          .map((ch) => {
            const chHeader = `📺 ${ch.title} [channel_id: ${ch.id}]`;
            const progLines = ch.programs.map((p) => formatProgram(p)).join("\n");
            return `${chHeader}\n${progLines}`;
          })
          .join("\n\n");

        return { content: [{ type: "text", text: headerLine + body }] };
      } catch (err) {
        return toolError(err);
      }
    }
  );
}
