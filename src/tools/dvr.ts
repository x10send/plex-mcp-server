import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type IPlexClient, PlexApiError } from "../plex-client.js";
import { toolError } from "./shared.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface DvrSubscriptionPrefs {
  oneShot?: unknown;
  startOffsetMinutes?: unknown;
  endOffsetMinutes?: unknown;
  onlyNewAirings?: unknown;
}

interface DvrSubscriptionHints {
  title?: unknown;
  year?: unknown;
  guid?: unknown;
  ratingKey?: unknown;
  thumb?: unknown;
  type?: unknown;
}

interface DvrSubscriptionParams {
  airingChannels?: unknown;
  airingTimes?: unknown;
  mediaProviderID?: unknown;
  libraryType?: unknown;
  deviceID?: unknown;
  dvrDeviceID?: unknown;
}

interface DvrSubscriptionDirectory {
  title?: unknown;
  year?: unknown;
  guid?: unknown;
  thumb?: unknown;
  nextScheduledRecording?: unknown; // Unix seconds
}

interface DvrSubscriptionMetadata {
  title?: unknown;
}

interface DvrSubscriptionVideo {
  title?: unknown;
  year?: unknown;
  guid?: unknown;
  thumb?: unknown;
  type?: unknown;
}

interface DvrSubscription {
  // ID — Plex field name varies by build; try all known variants.
  id?: unknown;
  key?: unknown;
  ratingKey?: unknown;
  subscriptionID?: unknown;
  type?: unknown;
  title?: unknown;
  thumb?: unknown;
  airingsType?: unknown; // e.g. "New and Repeat Airings", "New Airings Only"
  targetLibrarySectionID?: unknown;
  targetSectionLocationID?: unknown;
  // Flat fields — present in some Plex builds / legacy responses.
  channelTitle?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  startTimeOffset?: unknown;
  endTimeOffset?: unknown;
  status?: unknown;
  // Nested objects — camelCase or PascalCase; may be plain object or single-element array.
  prefs?: unknown;
  Prefs?: unknown;
  hints?: unknown;
  Hints?: unknown;
  params?: unknown;
  Params?: unknown;
  // Directory is the primary source of show metadata on GET responses.
  Directory?: unknown;
  // Video is the primary source of movie metadata on GET responses.
  Video?: unknown;
  // Additional nested metadata — Plex build variants.
  Metadata?: unknown;
  metadata?: unknown;
  // Flat title fallbacks — present in some Plex builds.
  grandparentTitle?: unknown;
  parentTitle?: unknown;
  programTitle?: unknown;
  showTitle?: unknown;
  librarySectionTitle?: unknown;
}

interface SubscriptionsResponse {
  MediaContainer: { MediaSubscription?: unknown };
}

interface EpgProvider {
  identifier?: unknown;
  id?: unknown;
  Feature?: Array<{ key?: unknown; type?: unknown }>;
}

interface EpgAiring {
  channelIdentifier?: unknown;
  channelVcn?: unknown;
  channelCallSign?: unknown;
  channelTitle?: unknown;
  beginsAt?: unknown;
}

interface GuideProgram {
  ratingKey?: unknown;
  key?: unknown;
  title?: unknown;
  grandparentTitle?: unknown;
  year?: unknown;
  thumb?: unknown;
  grandparentThumb?: unknown;
  Media?: EpgAiring[];
}

interface GuideResponse {
  MediaContainer: { Metadata?: GuideProgram[] };
}

interface DvrProvidersResponse {
  MediaContainer: { MediaProvider?: EpgProvider[] };
}

interface TemplateResponse {
  MediaContainer?: {
    SubscriptionTemplate?: Array<{
      MediaSubscription?: Array<{
        // Pre-encoded form body — values are double-encoded so GUIDs remain
        // percent-encoded after Plex's one form-body decode.
        parameters?: unknown;
        targetLibrarySectionID?: unknown;
        [key: string]: unknown;
      }>;
    }>;
  };
}

interface DvrHwDevice {
  deviceId?: unknown;
  key?: unknown;
  uuid?: unknown;
}

interface Dvr {
  key?: unknown;
  Device?: DvrHwDevice[];
}

interface DvrDevicesResponse {
  MediaContainer: { Dvr?: Dvr[] };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SUBSCRIPTIONS_PATH = "/media/subscriptions";

// Keys the subscription template's `parameters` field already encodes.
// When using the template (postRaw) path we exclude these from the extra
// params we append — the template values are authoritative for content identity.
const TEMPLATE_PARAM_KEYS = new Set([
  "hints[ratingKey]",
  "hints[guid]",
  "params[airingChannels]",
  "params[airingTimes]",
  "params[libraryType]",
  "params[mediaProviderID]",
]);

const DVR_NOT_CONFIGURED =
  "DVR is not configured on this Plex server, or no DVR device is paired. " +
  "Set up a tuner with DVR capability in Plex settings (Settings → Live TV & DVR).";

function formatLocalDateTime(epochSec: number): string {
  const d = new Date(epochSec * 1000);
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

function formatLocalTimeShort(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

// Parse "channelId=Display Name" format — may be a comma/semicolon-separated list.
function parseAiringChannels(raw: string): string {
  return raw
    .split(/[,;]/)
    .map((ch) => {
      const eq = ch.indexOf("=");
      return eq >= 0 ? ch.slice(eq + 1).trim() : ch.trim();
    })
    .filter(Boolean)
    .join(", ");
}

// Plex field-name helpers — try all known variants so we're resilient to build differences.

function subId(s: DvrSubscription): string {
  for (const v of [s.id, s.key, s.ratingKey, s.subscriptionID]) {
    if (v != null) return String(v);
  }
  return "?";
}

// Plex sometimes wraps a single child element in an array. Unwrap if needed.
function normaliseNested<T>(v: unknown): T | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return (v as unknown[])[0] as T | undefined;
  if (typeof v === "object") return v as T;
  return undefined;
}

function subHints(s: DvrSubscription): DvrSubscriptionHints | undefined {
  return (
    normaliseNested<DvrSubscriptionHints>(s.hints) ?? normaliseNested<DvrSubscriptionHints>(s.Hints)
  );
}

function subPrefs(s: DvrSubscription): DvrSubscriptionPrefs | undefined {
  return (
    normaliseNested<DvrSubscriptionPrefs>(s.prefs) ?? normaliseNested<DvrSubscriptionPrefs>(s.Prefs)
  );
}

function subParams(s: DvrSubscription): DvrSubscriptionParams | undefined {
  return (
    normaliseNested<DvrSubscriptionParams>(s.params) ??
    normaliseNested<DvrSubscriptionParams>(s.Params)
  );
}

function subDirectory(s: DvrSubscription): DvrSubscriptionDirectory | undefined {
  return normaliseNested<DvrSubscriptionDirectory>(s.Directory);
}

function subMetadata(s: DvrSubscription): DvrSubscriptionMetadata | undefined {
  return (
    normaliseNested<DvrSubscriptionMetadata>(s.Metadata) ??
    normaliseNested<DvrSubscriptionMetadata>(s.metadata)
  );
}

function subVideo(s: DvrSubscription): DvrSubscriptionVideo | undefined {
  return normaliseNested<DvrSubscriptionVideo>(s.Video);
}

// Resolve the best available show/movie title from the subscription, or undefined if none found.
// "All Episodes" is Plex's rule-type label, not a show title — excluded from resolution.
function resolveSubscriptionTitle(s: DvrSubscription): string | undefined {
  const dir = subDirectory(s);
  const video = subVideo(s);
  const hints = subHints(s);
  const meta = subMetadata(s);

  const dirTitle = dir?.title != null ? String(dir.title) : undefined;
  const videoTitle = video?.title != null ? String(video.title) : undefined;
  const hintsTitle = hints?.title != null ? String(hints.title) : undefined;
  const metaTitle = meta?.title != null ? String(meta.title) : undefined;
  const flatTitle =
    s.grandparentTitle != null
      ? String(s.grandparentTitle)
      : s.parentTitle != null
        ? String(s.parentTitle)
        : s.programTitle != null
          ? String(s.programTitle)
          : s.showTitle != null
            ? String(s.showTitle)
            : undefined;
  const rawTitle = s.title != null ? String(s.title) : undefined;
  const ruleTitle = rawTitle !== "All Episodes" ? rawTitle : undefined;

  return dirTitle ?? videoTitle ?? hintsTitle ?? metaTitle ?? flatTitle ?? ruleTitle;
}

function formatSubscription(s: DvrSubscription): string {
  const id = subId(s);
  const dir = subDirectory(s);
  const video = subVideo(s);
  const prefs = subPrefs(s);
  const params = subParams(s);

  const title = resolveSubscriptionTitle(s) ?? "Unknown";
  const isOneShot = Boolean(prefs?.oneShot);
  const isMovie =
    video != null ||
    Number(s.type) === 1 ||
    String(s.librarySectionTitle ?? "").toLowerCase() === "movies";

  const rawChannels =
    params?.airingChannels != null
      ? String(params.airingChannels)
      : s.channelTitle != null
        ? String(s.channelTitle)
        : "";
  const channelDisplay = rawChannels
    ? rawChannels.includes("=")
      ? parseAiringChannels(rawChannels)
      : rawChannels
    : "";

  const airingTimeSec =
    params?.airingTimes != null
      ? Number(params.airingTimes)
      : s.startTime != null
        ? Number(s.startTime)
        : undefined;
  const endSec = s.endTime != null ? Number(s.endTime) : undefined;
  const endOffsetMin = prefs?.endOffsetMinutes != null ? Number(prefs.endOffsetMinutes) : undefined;

  const nextRecSec =
    dir?.nextScheduledRecording != null ? Number(dir.nextScheduledRecording) : undefined;
  const airingsType = s.airingsType != null ? String(s.airingsType) : undefined;

  let displayTitle: string;
  if (isMovie) {
    const year = (video?.year ?? dir?.year) != null ? String(video?.year ?? dir?.year) : undefined;
    displayTitle = year ? `${title} (${year})` : title;
  } else {
    displayTitle = isOneShot ? title : `${title} — All Episodes`;
  }
  const lines: string[] = [`[ID: ${id}] ${displayTitle}`];

  if (channelDisplay) {
    const label = channelDisplay.includes(",") ? "Channels" : "Channel";
    lines.push(`  ${label}: ${channelDisplay}`);
  }

  if (isOneShot) {
    if (airingTimeSec !== undefined) {
      let scheduled = formatLocalDateTime(airingTimeSec);
      if (endSec !== undefined) scheduled += ` – ${formatLocalTimeShort(endSec)}`;
      lines.push(`  Scheduled: ${scheduled}`);
    }
  } else {
    if (nextRecSec !== undefined && nextRecSec > 0) {
      lines.push(`  Next: ${formatLocalDateTime(nextRecSec)}`);
    }
    if (airingsType) {
      lines.push(`  Filter: ${airingsType}`);
    } else if (nextRecSec === undefined) {
      lines.push(`  Any new airing`);
    }
  }

  if (endOffsetMin !== undefined && endOffsetMin > 0) {
    lines.push(`  Padding: +${endOffsetMin} min`);
  }

  if (title === "Unknown") {
    lines.push("  (title could not be resolved)");
  }

  return lines.join("\n");
}

// Plex may return MediaSubscription as an array or a bare object (single item).
function normaliseSubscriptions(raw: unknown): DvrSubscription[] {
  if (Array.isArray(raw)) return raw as DvrSubscription[];
  if (raw && typeof raw === "object") return [raw as DvrSubscription];
  return [];
}

// Repeatedly URL-decode until stable — EPG ratingKeys may be multiply encoded.
function fullyDecode(s: string): string {
  let prev = "";
  let curr = s;
  while (prev !== curr) {
    prev = curr;
    try {
      curr = decodeURIComponent(curr);
    } catch {
      break;
    }
  }
  return curr;
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerDvrTools(server: McpServer, client: IPlexClient): void {
  const debugMode = process.env.DEBUG_MCP === "true";

  server.tool(
    "get_scheduled_recordings",
    "List all DVR recording subscriptions grouped by type (one-shot episodes vs. series season passes) with IDs, channels, and air times. Use subscription IDs with cancel_recording.",
    {},
    async () => {
      try {
        let data: SubscriptionsResponse;
        try {
          data = await client.get<SubscriptionsResponse>(SUBSCRIPTIONS_PATH);
        } catch (err) {
          if (err instanceof PlexApiError && err.status === 404) {
            return { content: [{ type: "text", text: DVR_NOT_CONFIGURED }] };
          }
          throw err;
        }

        const subs = normaliseSubscriptions(data.MediaContainer?.MediaSubscription);
        if (subs.length === 0) {
          return { content: [{ type: "text", text: "No scheduled recordings." }] };
        }

        if (debugMode) {
          const unknowns = subs.filter((s) => resolveSubscriptionTitle(s) == null);
          const unresolvedNote =
            unknowns.length === 0
              ? `No unresolved subscriptions out of ${subs.length}.`
              : `Unresolved subscriptions (${unknowns.length} of ${subs.length}):\n` +
                JSON.stringify(unknowns, null, 2).slice(0, 8000);
          const first = subs[0] as Record<string, unknown> | undefined;
          const keyDump = first
            ? Object.entries(first)
                .map(([k, v]) => {
                  if (v === null) return `${k}: null`;
                  if (Array.isArray(v))
                    return `${k}: array(${(v as unknown[]).length})[${JSON.stringify((v as unknown[])[0]).slice(0, 80)}]`;
                  if (typeof v === "object")
                    return `${k}: object{${Object.keys(v as object).join(",")}}`;
                  return `${k}: ${typeof v}=${JSON.stringify(v).slice(0, 40)}`;
                })
                .join("\n  ")
            : "(empty)";
          const hintsRaw = first?.hints ?? first?.Hints;
          const hintsObj = normaliseNested<Record<string, unknown>>(hintsRaw);
          const hintsKeys = hintsObj
            ? `${Array.isArray(hintsRaw) ? "[array-wrapped] " : ""}${Object.keys(hintsObj).join(", ")}`
            : "(no hints/Hints field)";
          return {
            content: [
              {
                type: "text",
                text:
                  unresolvedNote +
                  `\n\nTotal subscriptions: ${subs.length}\n` +
                  `First entry fields:\n  ${keyDump}\n` +
                  `First entry hints keys: ${hintsKeys}\n\n` +
                  `First 2 entries (raw):\n` +
                  JSON.stringify(subs.slice(0, 2), null, 2).slice(0, 6000),
              },
            ],
          };
        }

        const oneShots = subs
          .filter((s) => Boolean(subPrefs(s)?.oneShot))
          .sort(
            (a, b) =>
              Number(subParams(a)?.airingTimes ?? a.startTime ?? 0) -
              Number(subParams(b)?.airingTimes ?? b.startTime ?? 0)
          );
        const seriesPass = subs.filter((s) => !subPrefs(s)?.oneShot);

        const indent = (text: string) =>
          text
            .split("\n")
            .map((l) => "  " + l)
            .join("\n");

        const header = `Scheduled Recordings (${subs.length}):\n`;
        const sections: string[] = [];
        if (oneShots.length > 0) {
          sections.push(
            `One-Shot Episodes:\n${oneShots.map((s) => indent(formatSubscription(s))).join("\n\n")}`
          );
        }
        if (seriesPass.length > 0) {
          sections.push(
            `Series Recordings:\n${seriesPass.map((s) => indent(formatSubscription(s))).join("\n\n")}`
          );
        }

        return { content: [{ type: "text", text: header + "\n" + sections.join("\n\n") }] };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_recording_conflicts",
    "Identify duplicate DVR recording subscriptions — same show or GUID scheduled more than once. Groups by guid (primary) or title (fallback), returning duplicate groups with IDs so you can cancel the extras with cancel_recording.",
    {},
    async () => {
      try {
        let data: SubscriptionsResponse;
        try {
          data = await client.get<SubscriptionsResponse>(SUBSCRIPTIONS_PATH);
        } catch (err) {
          if (err instanceof PlexApiError && err.status === 404) {
            return { content: [{ type: "text", text: DVR_NOT_CONFIGURED }] };
          }
          throw err;
        }

        const subs = normaliseSubscriptions(data.MediaContainer?.MediaSubscription);

        const byGuid = new Map<string, DvrSubscription[]>();
        const byTitle = new Map<string, DvrSubscription[]>();

        for (const s of subs) {
          const dir = subDirectory(s);
          const hints = subHints(s);
          const video = subVideo(s);
          const rawGuid = dir?.guid ?? hints?.guid ?? video?.guid;
          const guid = rawGuid != null ? String(rawGuid) : undefined;
          const title = resolveSubscriptionTitle(s);

          if (guid) {
            if (!byGuid.has(guid)) byGuid.set(guid, []);
            byGuid.get(guid)!.push(s);
          } else if (title) {
            if (!byTitle.has(title)) byTitle.set(title, []);
            byTitle.get(title)!.push(s);
          }
        }

        const conflicts: string[] = [];

        for (const [guid, group] of byGuid) {
          if (group.length <= 1) continue;
          const sorted = [...group].sort(
            (a, b) =>
              Number(subId(a) === "?" ? 0 : subId(a)) - Number(subId(b) === "?" ? 0 : subId(b))
          );
          const s0 = sorted[0];
          const label = resolveSubscriptionTitle(s0) ?? guid;
          const keepId = subId(sorted[0]);
          const cancelIds = sorted
            .slice(1)
            .map((s) => subId(s))
            .join(", ");
          conflicts.push(
            `${label}\n` +
              `  Duplicates: ${group.length}\n` +
              `  Keep ID: ${keepId}\n` +
              `  Cancel IDs: ${cancelIds}`
          );
        }

        for (const [title, group] of byTitle) {
          if (group.length <= 1) continue;
          const sorted = [...group].sort(
            (a, b) =>
              Number(subId(a) === "?" ? 0 : subId(a)) - Number(subId(b) === "?" ? 0 : subId(b))
          );
          const keepId = subId(sorted[0]);
          const cancelIds = sorted
            .slice(1)
            .map((s) => subId(s))
            .join(", ");
          conflicts.push(
            `${title} (matched by title)\n` +
              `  Duplicates: ${group.length}\n` +
              `  Keep ID: ${keepId}\n` +
              `  Cancel IDs: ${cancelIds}`
          );
        }

        if (conflicts.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No duplicate recordings found across ${subs.length} subscription${subs.length !== 1 ? "s" : ""}.`,
              },
            ],
          };
        }

        const header = `Found ${conflicts.length} duplicate group${conflicts.length !== 1 ? "s" : ""} across ${subs.length} subscriptions:\n\n`;
        return { content: [{ type: "text", text: header + conflicts.join("\n\n") }] };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "schedule_recording",
    [
      "Schedule a DVR recording for a specific program.",
      "Use get_live_tv_guide to obtain program_id, program_title, program_type, channel_id, channel_key, and airing_time, then pass them here.",
      "Use program_type='show' to create a season pass. Returns a subscription ID you can use with cancel_recording.",
    ].join(" "),
    {
      program_id: z
        .string()
        .min(1)
        .max(500)
        .describe("program_id from get_live_tv_guide (shown under each program)"),
      program_title: z
        .string()
        .min(1)
        .max(500)
        .optional()
        .describe(
          "program_title from get_live_tv_guide — helps Plex display and link the recording correctly. Recommended but not required."
        ),
      program_type: z
        .enum(["movie", "episode", "show"])
        .optional()
        .describe(
          "program_type from get_live_tv_guide. Use 'show' to create a season pass. Default: movie."
        ),
      channel_id: z
        .string()
        .min(1)
        .max(500)
        .optional()
        .describe("channel_id from get_live_tv_guide — used for guide filtering"),
      channel_key: z
        .string()
        .min(1)
        .max(500)
        .optional()
        .describe(
          "channel_key from get_live_tv_guide — sent as params[airingChannels] to help Plex match the airing to the correct channel (e.g. '3.1 KTVKDT (Independent)')"
        ),
      airing_time: z
        .number()
        .int()
        .optional()
        .describe(
          "airing_time from get_live_tv_guide (Unix seconds) — sent as params[airingTimes] to help Plex match the exact airing slot"
        ),
      start_offset_seconds: z
        .number()
        .int()
        .min(0)
        .max(600)
        .optional()
        .describe(
          "Start recording this many seconds early (0–600, rounded up to minutes). Default 0."
        ),
      end_offset_seconds: z
        .number()
        .int()
        .min(0)
        .max(3600)
        .optional()
        .describe(
          "Keep recording this many seconds past the end time (0–3600, rounded up to minutes). Default 5 minutes."
        ),
      target_library_section_id: z
        .string()
        .optional()
        .describe(
          'Library section ID for DVR recordings. Only needed if the automatic template lookup fails. Find it with get_libraries — look for the DVR or recording library section (e.g. "1").'
        ),
    },
    async (args) => {
      try {
        // 1. Fetch EPG provider info from /media/providers.
        let providerId: number;
        let guidePath: string;
        try {
          const providers = await client.get<DvrProvidersResponse>("/media/providers");
          const epgProvider = (providers.MediaContainer?.MediaProvider ?? []).find((p) =>
            String(p.identifier ?? "").includes("epg")
          );
          if (!epgProvider || epgProvider.id == null) {
            return { content: [{ type: "text", text: DVR_NOT_CONFIGURED }] };
          }
          providerId = Number(epgProvider.id);
          const epgIdentifier = String(epgProvider.identifier ?? "tv.plex.providers.epg.cloud");
          const guideFeature = (Array.isArray(epgProvider.Feature) ? epgProvider.Feature : []).find(
            (f) =>
              String(f.type ?? "").toLowerCase() === "grid" ||
              String(f.key ?? "")
                .toLowerCase()
                .includes("grid")
          );
          guidePath = guideFeature?.key ? String(guideFeature.key) : `/${epgIdentifier}/grid`;
        } catch (err) {
          if (err instanceof PlexApiError && err.status === 404) {
            return { content: [{ type: "text", text: DVR_NOT_CONFIGURED }] };
          }
          throw err;
        }

        // 2. Derive GUID by fully URL-decoding the ratingKey.
        //    EPG ratingKeys are percent-encoded (e.g. plex%3A%2F%2Fepisode%2Fabc).
        //    Plex expects hints[guid] in decoded form (plex://episode/abc).
        const programGuid = fullyDecode(args.program_id);

        // 3. Try to get targetLibrarySectionID from the subscription template.
        //    The template tells us which library the recording will go to.
        //    Silently skip on failure — the POST may still succeed without it.
        let sectionId: number | undefined;
        let templateParamStr: string | undefined;
        let templateRaw: string | undefined;
        let templateError: string | undefined;
        try {
          const tmpl = await client.get<TemplateResponse>("/media/subscriptions/template", {
            guid: programGuid,
          });
          const sub = tmpl.MediaContainer?.SubscriptionTemplate?.[0]?.MediaSubscription?.[0];
          if (sub?.parameters != null) {
            templateParamStr = String(sub.parameters);
          }
          if (sub?.targetLibrarySectionID != null) {
            sectionId = Number(sub.targetLibrarySectionID);
          }
          if (debugMode) {
            templateRaw = JSON.stringify(tmpl.MediaContainer, null, 2).slice(0, 3000);
          }
        } catch (err) {
          if (debugMode) {
            templateError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          }
          // Continue without template.
        }

        // 3.5. Guide lookup — fetch airing time and channel display string using channel_id.
        //      params[airingChannels] format: {channelId}={vcn} {callSign} ({title})
        //      params[airingTimes]: beginsAt unix seconds for the matched airing.
        //      Silently skipped on failure — the POST may still succeed without them.
        let resolvedAiringTime =
          args.airing_time !== undefined ? String(args.airing_time) : undefined;
        let resolvedAiringChannels: string | undefined;
        // hint fields — seeded from caller args, filled in by guide lookup below
        let hintTitle: string | undefined = args.program_title;
        let hintYear: string | undefined;
        let hintThumb: string | undefined;
        if (args.channel_key && args.channel_id) {
          resolvedAiringChannels = `${args.channel_id}=${args.channel_key}`;
        } else if (args.channel_id) {
          try {
            const nowSec = Math.floor(Date.now() / 1000);
            const guide = await client.get<GuideResponse>(guidePath, {
              "beginsAt<": String(nowSec + 7 * 24 * 3600),
              "endsAt>": String(nowSec),
            });
            const programs = Array.isArray(guide.MediaContainer?.Metadata)
              ? guide.MediaContainer.Metadata
              : [];
            const channelPrograms = programs.filter(
              (p) => String(p.Media?.[0]?.channelIdentifier ?? "") === args.channel_id
            );
            const matched =
              channelPrograms.find(
                (p) =>
                  String(p.ratingKey ?? "") === args.program_id ||
                  String(p.ratingKey ?? "") === programGuid
              ) ?? channelPrograms[0];
            if (matched) {
              if (!hintTitle) {
                const gTitle = matched.grandparentTitle
                  ? String(matched.grandparentTitle)
                  : undefined;
                hintTitle = gTitle ?? (matched.title ? String(matched.title) : undefined);
              }
              if (matched.year != null) hintYear = String(matched.year);
              const rawThumb = matched.grandparentThumb ?? matched.thumb;
              if (rawThumb != null) hintThumb = String(rawThumb);
              if (matched.Media?.[0]) {
                const media = matched.Media[0];
                if (resolvedAiringTime === undefined && media.beginsAt != null) {
                  resolvedAiringTime = String(media.beginsAt);
                }
                // channelTitle is already the full display string ("44.1 KPHELD (Independent)").
                // Constructing from vcn+callSign+title would double-wrap it.
                const display = String(media.channelTitle ?? media.channelCallSign ?? "");
                if (display) resolvedAiringChannels = `${args.channel_id}=${display}`;
              }
            }
          } catch {
            // Continue without airing info.
          }
        }

        // 3.7. Guard against past airings — Plex rejects subscriptions for airings that
        //      have already occurred. Catch this early to avoid a confusing 400 response.
        if (resolvedAiringTime !== undefined) {
          const airingTimeSec = parseInt(resolvedAiringTime, 10);
          const nowSec = Math.floor(Date.now() / 1000);
          if (!isNaN(airingTimeSec) && airingTimeSec < nowSec - 1800) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    `Cannot schedule: the airing at ${formatLocalDateTime(airingTimeSec)} has already passed. ` +
                    `Run get_live_tv_guide for a future window, then call schedule_recording immediately with the new data.`,
                },
              ],
            };
          }
        }

        // 4. Type depends on content: 1=movie, 2=TV/episode.
        //    Confirmed from stored Plex subscriptions: movie rules have type=1, TV rules have type=2.
        //    One-shot vs season pass is differentiated by prefs[oneShot], not type.
        //    Auto-detect from GUID when program_type is omitted (plex://movie/ → type 1).
        const isMovie =
          args.program_type === "movie" || (!args.program_type && programGuid.includes("//movie/"));
        const contentType = isMovie ? "1" : "2";
        const libraryType = isMovie ? "1" : "2";
        const oneShot = args.program_type === "show" ? "false" : "true";

        // 5. Convert second-based offsets to minutes (Plex API uses minutes).
        const startMin =
          args.start_offset_seconds !== undefined ? Math.ceil(args.start_offset_seconds / 60) : 0;
        const endMin =
          args.end_offset_seconds !== undefined ? Math.ceil(args.end_offset_seconds / 60) : 5;

        // 6. Fetch DVR device info from /livetv/dvrs.
        //    Structure: MediaContainer.Dvr[0].key = section location ID
        //               MediaContainer.Dvr[0].Device[0].deviceId = hardware device ID
        //               MediaContainer.Dvr[0].Device[0].key = DVR device key
        let dvrDeviceId: string | undefined;
        let dvrDeviceKey: string | undefined;
        let dvrSectionLocationId: string | undefined;
        let dvrRaw: string | undefined;
        try {
          const dvrs = await client.get<DvrDevicesResponse>("/livetv/dvrs");
          const dvr = dvrs.MediaContainer?.Dvr?.[0];
          if (dvr?.key != null) dvrSectionLocationId = String(dvr.key);
          const device = dvr?.Device?.[0];
          if (device?.deviceId != null) dvrDeviceId = String(device.deviceId);
          if (device?.key != null) dvrDeviceKey = String(device.key);
          if (debugMode) dvrRaw = JSON.stringify(dvrs.MediaContainer, null, 2).slice(0, 3000);
        } catch {
          // Continue without DVR device info.
        }

        // 7. Build the POST params.
        const params: Record<string, string> = {
          type: contentType,
          targetSectionLocationID: dvrSectionLocationId ?? "",
          "params[mediaProviderID]": String(providerId),
          "params[libraryType]": libraryType,
          "prefs[onlyNewAirings]": "1",
          "prefs[minVideoQuality]": "0",
          "prefs[replaceLowerQuality]": "false",
          "prefs[recordPartials]": "true",
          "prefs[startOffsetMinutes]": String(startMin),
          "prefs[endOffsetMinutes]": String(endMin),
          "prefs[startTimeslot]": "-1",
          "prefs[comskipEnabled]": "-1",
          "prefs[comskipMethod]": "1",
          "prefs[oneShot]": oneShot,
          "prefs[remoteMedia]": "false",
          "prefs[autoDeletionItemPolicyUnwatchedLibrary]": "0",
          "prefs[autoDeletionItemPolicyWatchedLibrary]": "0",
          "hints[type]": contentType,
          "hints[ratingKey]": programGuid,
          "hints[guid]": programGuid,
        };
        if (hintTitle) params["hints[title]"] = hintTitle;
        if (hintYear) params["hints[year]"] = hintYear;
        if (hintThumb) params["hints[thumb]"] = hintThumb;
        if (resolvedAiringChannels) params["params[airingChannels]"] = resolvedAiringChannels;
        if (resolvedAiringTime !== undefined) params["params[airingTimes]"] = resolvedAiringTime;
        const effectiveSectionId: string | undefined =
          args.target_library_section_id ??
          (sectionId !== undefined ? String(sectionId) : undefined);
        if (effectiveSectionId !== undefined) {
          params["targetLibrarySectionID"] = effectiveSectionId;
        }
        if (dvrDeviceId !== undefined) params["params[deviceID]"] = dvrDeviceId;
        if (dvrDeviceKey !== undefined) params["params[dvrDeviceID]"] = dvrDeviceKey;

        // 8. Collect debug info and run pre-flight check.
        const sectionIdSource =
          args.target_library_section_id != null
            ? "explicit argument"
            : sectionId != null
              ? "template"
              : "unresolved";
        const debugLines: string[] = [];
        if (debugMode) {
          debugLines.push("=== DEBUG: schedule_recording ===");
          debugLines.push(`providerId: ${providerId}`);
          debugLines.push(`programGuid: ${programGuid}`);
          debugLines.push(`targetLibrarySectionID source: ${sectionIdSource}`);
          debugLines.push(`targetLibrarySectionID = ${effectiveSectionId ?? "not found"}`);
          debugLines.push(`dvrSectionLocationId: ${dvrSectionLocationId ?? "not found"}`);
          debugLines.push(`dvrDeviceId: ${dvrDeviceId ?? "not found"}`);
          debugLines.push(`dvrDeviceKey: ${dvrDeviceKey ?? "not found"}`);
          if (templateError) debugLines.push(`Template fetch error: ${templateError}`);
          if (templateRaw) debugLines.push(`Template response:\n${templateRaw}`);
          if (dvrRaw) debugLines.push(`/livetv/dvrs response:\n${dvrRaw}`);
          debugLines.push("Pre-flight check:");
          const preflightFields: Array<[string, string | undefined]> = [
            ["targetLibrarySectionID", params["targetLibrarySectionID"]],
            ["targetSectionLocationID", params["targetSectionLocationID"]],
            ["params[deviceID]", params["params[deviceID]"]],
            ["params[dvrDeviceID]", params["params[dvrDeviceID]"]],
            ["params[airingChannels]", params["params[airingChannels]"]],
            ["params[airingTimes]", params["params[airingTimes]"]],
          ];
          for (const [field, value] of preflightFields) {
            const ok = value != null && value !== "";
            debugLines.push(`  ${ok ? "✓" : "✗"} ${field}${ok ? "" : " — MISSING"}`);
          }
          debugLines.push(`Template found: ${templateParamStr != null}`);
          debugLines.push(
            `Body source: ${templateParamStr != null ? "template (postRaw)" : "fallback (URL query params)"}`
          );
          if (templateParamStr != null) {
            debugLines.push("Extra params (appended to template body):");
            for (const [k, v] of Object.entries(params)) {
              if (!TEMPLATE_PARAM_KEYS.has(k)) debugLines.push(`  ${k} = ${v}`);
            }
            debugLines.push(`Endpoint: POST ${SUBSCRIPTIONS_PATH} (form body)`);
          } else {
            debugLines.push("POST params:");
            for (const [k, v] of Object.entries(params)) {
              debugLines.push(`  ${k} = ${v}`);
            }
            debugLines.push(`Endpoint: POST ${SUBSCRIPTIONS_PATH} (params as URL query string)`);
          }
          debugLines.push("=================================");
        }

        // 9. Pre-flight abort: targetLibrarySectionID is required by Plex.
        if (params["targetLibrarySectionID"] == null) {
          const hint =
            "Provide target_library_section_id (run get_libraries to find the right section ID).";
          if (debugMode) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    debugLines.join("\n") +
                    `\n\nPre-flight failed: targetLibrarySectionID missing. Aborting before POST.\n${hint}`,
                },
              ],
            };
          }
          return {
            content: [
              { type: "text", text: `Pre-flight failed: targetLibrarySectionID missing. ${hint}` },
            ],
          };
        }

        let data: SubscriptionsResponse;
        try {
          if (templateParamStr != null) {
            // Use the pre-assembled form body Plex provided for this GUID as the base,
            // then append the extra fields the template omits (prefs, type, section IDs,
            // device IDs, hint display fields). This is what Plex's own UI sends and is
            // required for movies — client.post() (URL query params) causes 400 for movies.
            const extraBody = Object.entries(params)
              .filter(([k]) => !TEMPLATE_PARAM_KEYS.has(k))
              .map(
                ([k, v]) =>
                  `${encodeURIComponent(k).replace(/%5B/gi, "[").replace(/%5D/gi, "]")}=${encodeURIComponent(v)}`
              )
              .join("&");
            data = await client.postRaw<SubscriptionsResponse>(
              SUBSCRIPTIONS_PATH,
              `${templateParamStr}&${extraBody}`
            );
          } else {
            data = await client.post<SubscriptionsResponse>(SUBSCRIPTIONS_PATH, params);
          }
        } catch (err) {
          if (debugMode && err instanceof PlexApiError) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    debugLines.join("\n") +
                    `\n\nPOST failed: HTTP ${err.status}\nError: ${err.message}`,
                },
              ],
            };
          }
          if (err instanceof PlexApiError && err.status === 404) {
            return { content: [{ type: "text", text: DVR_NOT_CONFIGURED }] };
          }
          throw err;
        }

        const subs = normaliseSubscriptions(data.MediaContainer?.MediaSubscription);
        const sub = subs[0];
        if (!sub) {
          const noSubMsg = "Recording scheduled but Plex returned no subscription details.";
          return {
            content: [
              {
                type: "text",
                text: debugMode ? debugLines.join("\n") + "\n\n" + noSubMsg : noSubMsg,
              },
            ],
          };
        }

        const subPa = subParams(sub);
        const lines = [
          `Recording scheduled.`,
          `Subscription ID: ${subId(sub)} (use this to cancel)`,
        ];
        const displayTitle = resolveSubscriptionTitle(sub);
        if (displayTitle) lines.push(`Title: ${displayTitle}`);
        const rawChannels =
          subPa?.airingChannels != null
            ? String(subPa.airingChannels)
            : sub.channelTitle != null
              ? String(sub.channelTitle)
              : "";
        if (rawChannels) {
          const channelDisplay = rawChannels.includes("=")
            ? parseAiringChannels(rawChannels)
            : rawChannels;
          if (channelDisplay) lines.push(`Channel: ${channelDisplay}`);
        }
        const startSec =
          subPa?.airingTimes != null
            ? Number(subPa.airingTimes)
            : sub.startTime != null
              ? Number(sub.startTime)
              : undefined;
        if (startSec) lines.push(`Scheduled: ${formatLocalDateTime(startSec)}`);

        const body = lines.join("\n");
        return {
          content: [
            {
              type: "text",
              text: debugMode ? debugLines.join("\n") + "\n\n" + body : body,
            },
          ],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "update_recording",
    [
      "Update the start/end padding on an existing DVR recording subscription.",
      "Creates a new subscription with the updated padding, then cancels the old one.",
      "If the POST step fails, the original subscription is preserved unchanged.",
      "Use get_scheduled_recordings to find subscription IDs.",
    ].join(" "),
    {
      subscription_id: z
        .string()
        .regex(/^\d+$/, "Subscription ID must be a positive integer")
        .describe("Subscription ID to update (from get_scheduled_recordings)"),
      start_offset_seconds: z
        .number()
        .int()
        .min(0)
        .max(600)
        .optional()
        .describe(
          "Start recording this many seconds early (0–600, rounded up to minutes). Omit to keep existing value."
        ),
      end_offset_seconds: z
        .number()
        .int()
        .min(0)
        .max(3600)
        .optional()
        .describe(
          "Keep recording this many seconds past the end time (0–3600, rounded up to minutes). Omit to keep existing value."
        ),
      target_library_section_id: z
        .string()
        .optional()
        .describe(
          "Override the library section ID. Only needed if the stored subscription is missing this field."
        ),
    },
    async (args) => {
      try {
        // 1. Fetch the subscription list and find the target.
        let subList: SubscriptionsResponse;
        try {
          subList = await client.get<SubscriptionsResponse>(SUBSCRIPTIONS_PATH);
        } catch (err) {
          if (err instanceof PlexApiError && err.status === 404) {
            return { content: [{ type: "text", text: DVR_NOT_CONFIGURED }] };
          }
          throw err;
        }

        const subs = normaliseSubscriptions(subList.MediaContainer?.MediaSubscription);
        const sub = subs.find((s) => subId(s) === args.subscription_id);
        if (!sub) {
          return {
            content: [
              {
                type: "text",
                text: `Subscription ${args.subscription_id} not found. Run get_scheduled_recordings to list current subscriptions.`,
              },
            ],
          };
        }

        // 2. Extract params from the stored subscription.
        const hints = subHints(sub);
        const sp = subParams(sub);
        const prefs = subPrefs(sub);

        const contentType = sub.type != null ? String(sub.type) : "2";
        const guid = hints?.guid != null ? String(hints.guid) : undefined;
        const ratingKey = hints?.ratingKey != null ? String(hints.ratingKey) : guid;
        const hintType = hints?.type != null ? String(hints.type) : contentType;
        const hintTitle = hints?.title != null ? String(hints.title) : undefined;
        const hintYear = hints?.year != null ? String(hints.year) : undefined;
        const hintThumb = hints?.thumb != null ? String(hints.thumb) : undefined;

        const airingChannels = sp?.airingChannels != null ? String(sp.airingChannels) : undefined;
        const airingTimes = sp?.airingTimes != null ? String(sp.airingTimes) : undefined;
        const mediaProviderID =
          sp?.mediaProviderID != null ? String(sp.mediaProviderID) : undefined;
        const storedLibraryType = sp?.libraryType != null ? String(sp.libraryType) : contentType;
        const storedDeviceId = sp?.deviceID != null ? String(sp.deviceID) : undefined;
        const storedDvrDeviceId = sp?.dvrDeviceID != null ? String(sp.dvrDeviceID) : undefined;

        const oneShot = prefs?.oneShot != null ? (prefs.oneShot ? "true" : "false") : "true";

        // targetLibrarySectionID: explicit arg > stored in sub
        const storedSectionId =
          sub.targetLibrarySectionID != null ? String(sub.targetLibrarySectionID) : undefined;
        const effectiveSectionId = args.target_library_section_id ?? storedSectionId;

        const storedSectionLocId =
          sub.targetSectionLocationID != null ? String(sub.targetSectionLocationID) : "";

        // 3. Compute new offsets (preserve existing when arg is omitted).
        const startMin =
          args.start_offset_seconds !== undefined
            ? Math.ceil(args.start_offset_seconds / 60)
            : prefs?.startOffsetMinutes != null
              ? Number(prefs.startOffsetMinutes)
              : 0;
        const endMin =
          args.end_offset_seconds !== undefined
            ? Math.ceil(args.end_offset_seconds / 60)
            : prefs?.endOffsetMinutes != null
              ? Number(prefs.endOffsetMinutes)
              : 5;

        // 4. Require guid to reconstruct the subscription.
        if (guid == null) {
          return {
            content: [
              {
                type: "text",
                text: `Cannot update subscription ${args.subscription_id}: hints.guid not found in stored data. Cancel with cancel_recording and recreate with schedule_recording instead.`,
              },
            ],
          };
        }

        // 5. Build POST params using stored values.
        const params: Record<string, string> = {
          type: contentType,
          targetSectionLocationID: storedSectionLocId,
          "params[libraryType]": storedLibraryType,
          "prefs[onlyNewAirings]": "1",
          "prefs[minVideoQuality]": "0",
          "prefs[replaceLowerQuality]": "false",
          "prefs[recordPartials]": "true",
          "prefs[startOffsetMinutes]": String(startMin),
          "prefs[endOffsetMinutes]": String(endMin),
          "prefs[startTimeslot]": "-1",
          "prefs[comskipEnabled]": "-1",
          "prefs[comskipMethod]": "1",
          "prefs[oneShot]": oneShot,
          "prefs[remoteMedia]": "false",
          "prefs[autoDeletionItemPolicyUnwatchedLibrary]": "0",
          "prefs[autoDeletionItemPolicyWatchedLibrary]": "0",
          "hints[type]": hintType,
          "hints[guid]": guid,
        };
        if (ratingKey) params["hints[ratingKey]"] = ratingKey;
        if (hintTitle) params["hints[title]"] = hintTitle;
        if (hintYear) params["hints[year]"] = hintYear;
        if (hintThumb) params["hints[thumb]"] = hintThumb;
        if (mediaProviderID) params["params[mediaProviderID]"] = mediaProviderID;
        if (airingChannels) params["params[airingChannels]"] = airingChannels;
        if (airingTimes) params["params[airingTimes]"] = airingTimes;
        if (effectiveSectionId) params["targetLibrarySectionID"] = effectiveSectionId;

        // Device params: prefer stored values, refresh from /livetv/dvrs if absent.
        let deviceId = storedDeviceId;
        let dvrDeviceKey = storedDvrDeviceId;
        if (deviceId == null || dvrDeviceKey == null) {
          try {
            const dvrs = await client.get<DvrDevicesResponse>("/livetv/dvrs");
            const dvr = dvrs.MediaContainer?.Dvr?.[0];
            const device = dvr?.Device?.[0];
            if (deviceId == null && device?.deviceId != null) deviceId = String(device.deviceId);
            if (dvrDeviceKey == null && device?.key != null) dvrDeviceKey = String(device.key);
            if (!params["targetSectionLocationID"] && dvr?.key != null)
              params["targetSectionLocationID"] = String(dvr.key);
          } catch {
            // Continue without updated device info.
          }
        }
        if (deviceId) params["params[deviceID]"] = deviceId;
        if (dvrDeviceKey) params["params[dvrDeviceID]"] = dvrDeviceKey;

        const debugLines: string[] = [];
        if (debugMode) {
          debugLines.push("=== DEBUG: update_recording ===");
          debugLines.push(`Subscription ID: ${args.subscription_id}`);
          debugLines.push(`guid: ${guid}`);
          debugLines.push(`contentType: ${contentType}`);
          debugLines.push(`oneShot: ${oneShot}`);
          debugLines.push(`targetLibrarySectionID: ${effectiveSectionId ?? "not found"}`);
          debugLines.push(`New startMin: ${startMin}, endMin: ${endMin}`);
          debugLines.push("POST params:");
          for (const [k, v] of Object.entries(params)) {
            debugLines.push(`  ${k} = ${v}`);
          }
          debugLines.push("=================================");
        }

        // 6. POST new subscription first — preserves original if POST fails.
        let newData: SubscriptionsResponse;
        try {
          newData = await client.post<SubscriptionsResponse>(SUBSCRIPTIONS_PATH, params);
        } catch (err) {
          if (debugMode && err instanceof PlexApiError) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    debugLines.join("\n") +
                    `\n\nPOST failed: HTTP ${err.status}\nError: ${err.message}\nOriginal subscription ${args.subscription_id} is unchanged.`,
                },
              ],
            };
          }
          if (err instanceof PlexApiError && err.status === 404) {
            return { content: [{ type: "text", text: DVR_NOT_CONFIGURED }] };
          }
          throw err;
        }

        // 7. DELETE the old subscription.
        const deleteEndpoint = `${SUBSCRIPTIONS_PATH}/${args.subscription_id}`;
        let deleteWarning: string | undefined;
        try {
          await client.delete<SubscriptionsResponse>(deleteEndpoint);
        } catch (err) {
          const errMsg =
            err instanceof PlexApiError ? `HTTP ${err.status} — ${err.message}` : String(err);
          deleteWarning = `Warning: could not cancel original subscription ${args.subscription_id}: ${errMsg}. Run cancel_recording with subscription_id=${args.subscription_id} to clean up.`;
        }

        // 8. Format response.
        const newSubs = normaliseSubscriptions(newData.MediaContainer?.MediaSubscription);
        const newSub = newSubs[0];
        const newSubId = newSub ? subId(newSub) : "?";
        const title = newSub ? resolveSubscriptionTitle(newSub) : undefined;

        const lines = [
          `Recording updated.`,
          `New Subscription ID: ${newSubId} (use this to cancel)`,
          `Old subscription ${args.subscription_id} cancelled.`,
        ];
        if (title) lines.push(`Title: ${title}`);
        lines.push(`Padding: start −${startMin} min, end +${endMin} min`);
        if (deleteWarning) lines.push(`\n${deleteWarning}`);

        const body = lines.join("\n");
        return {
          content: [
            { type: "text", text: debugMode ? debugLines.join("\n") + "\n\n" + body : body },
          ],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "cancel_recording",
    "Cancel a scheduled DVR recording by subscription ID. Use get_scheduled_recordings to find the ID. This removes the recording subscription from Plex.",
    {
      subscription_id: z
        .string()
        .regex(/^\d+$/, "Subscription ID must be a positive integer")
        .describe("Subscription ID from get_scheduled_recordings or schedule_recording"),
    },
    async (args) => {
      try {
        const endpoint = `${SUBSCRIPTIONS_PATH}/${args.subscription_id}`;
        const debugLines: string[] = [];

        if (debugMode) {
          debugLines.push("=== DEBUG: cancel_recording ===");
          debugLines.push(`Endpoint: DELETE ${endpoint}`);
        }

        // Issue DELETE — Plex sometimes echoes the deleted subscription back.
        let deleteResponse: SubscriptionsResponse | undefined;
        try {
          deleteResponse = await client.delete<SubscriptionsResponse>(endpoint);
        } catch (err) {
          if (debugMode && err instanceof PlexApiError) {
            debugLines.push(`Delete response: HTTP ${err.status} — ${err.message}`);
            debugLines.push("=================================");
            return {
              content: [
                {
                  type: "text",
                  text:
                    debugLines.join("\n") +
                    `\n\nFailed to cancel subscription ${args.subscription_id}: HTTP ${err.status} — ${err.message}`,
                },
              ],
            };
          }
          throw err;
        }

        if (debugMode) {
          const raw =
            deleteResponse != null
              ? JSON.stringify(deleteResponse, null, 2).slice(0, 1000)
              : "(empty)";
          debugLines.push(`Delete response: ${raw}`);
        }

        // Try to recover the title from the DELETE echo-back.
        const deletedSubs = normaliseSubscriptions(
          deleteResponse?.MediaContainer?.MediaSubscription
        );
        const title = deletedSubs[0] ? resolveSubscriptionTitle(deletedSubs[0]) : undefined;

        // Verify removal by re-fetching the subscription list.
        let verified: boolean | undefined;
        try {
          const remaining = await client.get<SubscriptionsResponse>(SUBSCRIPTIONS_PATH);
          const remainingSubs = normaliseSubscriptions(
            remaining?.MediaContainer?.MediaSubscription
          );
          verified = !remainingSubs.some((s) => subId(s) === args.subscription_id);
          if (debugMode) {
            debugLines.push(`Verification GET: ${SUBSCRIPTIONS_PATH}`);
            debugLines.push(`Subscription ${args.subscription_id} still in list: ${!verified}`);
          }
        } catch {
          if (debugMode) debugLines.push("Verification: could not fetch subscription list");
        }

        if (debugMode) debugLines.push("=================================");

        const lines = [`Recording subscription ${args.subscription_id} cancelled.`];
        if (title) lines.push(`  Title: ${title}`);
        if (verified === true) {
          lines.push(`  Verified: removed from subscription list`);
        } else if (verified === false) {
          lines.push(
            `  Warning: subscription still appears in list — Plex may need a moment to update`
          );
        }

        const body = lines.join("\n");
        return {
          content: [
            { type: "text", text: debugMode ? debugLines.join("\n") + "\n\n" + body : body },
          ],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );
}
