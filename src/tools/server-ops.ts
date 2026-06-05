import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IPlexClient } from "../plex-client.js";
import { toolError } from "./shared.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface ServerInfoContainer {
  MediaContainer: {
    friendlyName?: unknown;
    machineIdentifier?: unknown;
    version?: unknown;
    platform?: unknown;
    platformVersion?: unknown;
    myPlexUsername?: unknown;
    myPlexSubscription?: unknown;
    transcoderActiveVideoSessions?: unknown;
    livetv?: unknown;
    updatedAt?: unknown;
  };
}

interface StatisticsBandwidth {
  bytes?: unknown;
  direction?: unknown;
}

interface StatisticsResponse {
  MediaContainer: { StatisticsBandwidth?: StatisticsBandwidth[] };
}

interface Activity {
  title?: unknown;
  subtitle?: unknown;
  progress?: unknown;
  cancellable?: unknown;
  type?: unknown;
}

interface ActivitiesResponse {
  MediaContainer: { Activity?: Activity[] };
}

interface ButlerTask {
  name?: unknown;
  title?: unknown;
  enabled?: unknown;
  schedule?: unknown;
  lastExecution?: unknown;
  nextExecution?: unknown;
  lastExecutionResult?: unknown;
}

interface ButlerResponse {
  MediaContainer: { ButlerTask?: ButlerTask[] };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatTimestamp(epoch: number): string {
  return new Date(epoch * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

// Activity type classification — map Plex internal type/title to friendly category.
function classifyActivity(a: Activity): string {
  const type = String(a.type ?? "").toLowerCase();
  const title = String(a.title ?? "").toLowerCase();

  if (type.includes("dvr") || title.startsWith("recording")) return "recording";
  if (type.includes("subtitle") || title.includes("refreshing sub") || title.includes("subtitle"))
    return "subtitle";
  if (type.includes("library") || title.includes("scan") || title.includes("scanning"))
    return "scan";
  if (type.includes("metadata") || title.includes("metadata")) return "metadata";
  if (type.includes("download") || title.includes("download")) return "download";
  return "other";
}

const GROUP_LABELS: Record<string, string> = {
  recording: "Recordings",
  scan: "Library Scans",
  metadata: "Metadata Refresh",
  download: "Downloads",
  other: "Other",
  subtitle: "Subtitle Refresh",
};

// Priority order for grouped display (recordings and scans first, subtitles last).
const PRIORITY_ORDER = ["recording", "scan", "metadata", "download", "other", "subtitle"];

// Threshold: groups with this many or more items are collapsed to a summary (except recordings).
const COLLAPSE_THRESHOLD = 4;

function formatActivityItem(a: Activity): string {
  const title = String(a.title ?? "Unknown activity");
  const cancellable = a.cancellable ? " [cancellable]" : "";
  const subtitle = a.subtitle ? `\n  ${String(a.subtitle).slice(0, 150)}` : "";
  const progress =
    a.progress !== undefined ? `\n  Progress: ${Math.round(Number(a.progress))}%` : "";
  return `${title}${cancellable}${subtitle}${progress}`;
}

function collapseSummary(items: Activity[]): string {
  const progresses = items
    .map((a) => (a.progress !== undefined ? Number(a.progress) : null))
    .filter((n): n is number => n !== null);
  const avg =
    progresses.length > 0
      ? Math.round(progresses.reduce((a, b) => a + b, 0) / progresses.length)
      : null;
  const stalled = items.filter((a) => Number(a.progress ?? -1) === 0).length;
  let s = `${items.length} jobs in progress`;
  if (avg !== null) s += ` (avg ${avg}% complete)`;
  if (stalled > 0) s += ` [${stalled} stalled]`;
  return s;
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerServerOpsTools(server: McpServer, client: IPlexClient): void {
  server.tool(
    "get_server_info",
    "Get Plex Media Server details: friendly name, version, platform, Plex Pass status, active transcode count, and Live TV availability.",
    {},
    async () => {
      try {
        const data = await client.get<ServerInfoContainer>("/");
        const mc = data.MediaContainer;
        const lines: string[] = [
          `Name: ${mc.friendlyName ?? "Unknown"}`,
          `Version: ${mc.version ?? "Unknown"}`,
          `Platform: ${mc.platform ?? "Unknown"}${mc.platformVersion ? ` ${mc.platformVersion}` : ""}`,
          `Machine ID: ${mc.machineIdentifier ?? "Unknown"}`,
        ];
        if (mc.myPlexUsername) lines.push(`Plex account: ${mc.myPlexUsername}`);
        lines.push(`Plex Pass: ${mc.myPlexSubscription ? "yes" : "no"}`);
        lines.push(`Active video transcodes: ${mc.transcoderActiveVideoSessions ?? 0}`);
        lines.push(`Live TV: ${mc.livetv ? "available" : "not configured"}`);
        if (mc.updatedAt) lines.push(`Last updated: ${formatTimestamp(Number(mc.updatedAt))}`);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_server_statistics",
    "Get Plex Media Server bandwidth statistics — total data transferred, broken down by LAN vs WAN, over a chosen time window.",
    {
      timespan: z
        .enum(["hours", "days", "weeks", "months"])
        .optional()
        .describe("Time window for statistics. Defaults to 'days'."),
    },
    async (args) => {
      // Plex timespan codes: 6=hours, 4=days, 3=weeks, 2=months
      const timespanCode: Record<string, string> = {
        hours: "6",
        days: "4",
        weeks: "3",
        months: "2",
      };
      const timespan = args.timespan ?? "days";
      try {
        const data = await client.get<StatisticsResponse>("/statistics/bandwidth", {
          timespan: timespanCode[timespan],
        });
        const stats = data.MediaContainer?.StatisticsBandwidth ?? [];
        if (stats.length === 0) {
          return { content: [{ type: "text", text: "No bandwidth statistics available." }] };
        }

        let lanBytes = 0;
        let wanBytes = 0;
        for (const s of stats) {
          const bytes = Number(s.bytes ?? 0);
          if (Number(s.direction) === 0) lanBytes += bytes;
          else wanBytes += bytes;
        }
        const totalBytes = lanBytes + wanBytes;

        const lines = [
          `Bandwidth statistics (last ${timespan})`,
          `  Total: ${formatBytes(totalBytes)}`,
          `  LAN:   ${formatBytes(lanBytes)}`,
          `  WAN:   ${formatBytes(wanBytes)}`,
          `  Data points: ${stats.length}`,
        ];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_activities",
    [
      "List active background activities on the Plex server — library scans, metadata refreshes, artwork downloads, DVR recordings, and other ongoing tasks.",
      "Results are grouped by type with recordings surfaced first. Repetitive jobs (e.g. subtitle refreshes) are summarized.",
      "Use the type filter to target a specific category: recording, subtitle, scan, metadata, download, or other.",
    ].join(" "),
    {
      type: z
        .enum(["recording", "subtitle", "scan", "metadata", "download", "other"])
        .optional()
        .describe(
          "Filter to a specific activity type. If omitted, all activities are returned grouped by type."
        ),
    },
    async (args) => {
      try {
        const data = await client.get<ActivitiesResponse>("/activities");
        const activities = data.MediaContainer?.Activity ?? [];
        if (activities.length === 0) {
          return { content: [{ type: "text", text: "No active background activities." }] };
        }

        const classified = activities.map((a) => ({ a, cat: classifyActivity(a) }));

        // Type filter: return flat list for the requested category.
        if (args.type) {
          const filtered = classified.filter((c) => c.cat === args.type);
          if (filtered.length === 0) {
            return {
              content: [{ type: "text", text: `No active ${args.type} activities.` }],
            };
          }
          const label = GROUP_LABELS[args.type] ?? args.type;
          const header = `${label} (${filtered.length})\n\n`;
          const body = filtered.map(({ a }) => formatActivityItem(a)).join("\n\n");
          return { content: [{ type: "text", text: header + body }] };
        }

        // Grouped view: build one section per category in priority order.
        const groups = new Map<string, Activity[]>();
        for (const t of PRIORITY_ORDER) groups.set(t, []);
        for (const { a, cat } of classified) groups.get(cat)!.push(a);

        const sections: string[] = [];
        for (const t of PRIORITY_ORDER) {
          const items = groups.get(t) ?? [];
          if (items.length === 0) continue;
          const label = GROUP_LABELS[t] ?? t;
          if (t !== "recording" && items.length >= COLLAPSE_THRESHOLD) {
            sections.push(`${label} (${items.length}): ${collapseSummary(items)}`);
          } else {
            const lines = items.map(formatActivityItem).join("\n\n");
            sections.push(`${label} (${items.length}):\n${lines}`);
          }
        }

        const total = activities.length;
        const header = `Background activities (${total})\n`;
        return { content: [{ type: "text", text: header + "\n" + sections.join("\n\n") }] };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_butler_tasks",
    "List Plex Butler scheduled maintenance tasks (database backup, artwork cleanup, etc.) with their schedule, last run time, and result.",
    {},
    async () => {
      try {
        const data = await client.get<ButlerResponse>("/butler");
        const tasks = data.MediaContainer?.ButlerTask ?? [];
        if (tasks.length === 0) {
          return { content: [{ type: "text", text: "No butler tasks found." }] };
        }
        const header = `Butler tasks (${tasks.length})\n\n`;
        const body = tasks
          .map((t) => {
            const title = String(t.title ?? t.name ?? "Unknown");
            const enabled = t.enabled ? "" : " [disabled]";
            const schedule = t.schedule ? `\n  Schedule: ${t.schedule}` : "";
            const lastResult = t.lastExecutionResult
              ? `\n  Last result: ${t.lastExecutionResult}`
              : "";
            const lastRun = t.lastExecution
              ? `\n  Last run: ${formatTimestamp(Number(t.lastExecution))}`
              : "";
            const nextRun = t.nextExecution
              ? `\n  Next run: ${formatTimestamp(Number(t.nextExecution))}`
              : "";
            return `${title}${enabled}${schedule}${lastResult}${lastRun}${nextRun}`;
          })
          .join("\n\n");
        return { content: [{ type: "text", text: header + body }] };
      } catch (err) {
        return toolError(err);
      }
    }
  );
}
