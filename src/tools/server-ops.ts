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
    "List active background activities on the Plex server — library scans, metadata refreshes, artwork downloads, and other ongoing tasks.",
    {},
    async () => {
      try {
        const data = await client.get<ActivitiesResponse>("/activities");
        const activities = data.MediaContainer?.Activity ?? [];
        if (activities.length === 0) {
          return { content: [{ type: "text", text: "No active background activities." }] };
        }
        const header = `Background activities (${activities.length})\n\n`;
        const body = activities
          .map((a) => {
            const title = String(a.title ?? "Unknown activity");
            const cancellable = a.cancellable ? " [cancellable]" : "";
            const subtitle = a.subtitle ? `\n  ${String(a.subtitle).slice(0, 150)}` : "";
            const progress =
              a.progress !== undefined ? `\n  Progress: ${Math.round(Number(a.progress))}%` : "";
            return `${title}${cancellable}${subtitle}${progress}`;
          })
          .join("\n\n");
        return { content: [{ type: "text", text: header + body }] };
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
