import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type IPlexClient, PlexApiError } from "../plex-client.js";
import { toolError } from "./shared.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface DvrSubscription {
  id?: unknown;
  title?: unknown;
  type?: unknown;
  channelTitle?: unknown;
  channelKey?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  startTimeOffset?: unknown;
  endTimeOffset?: unknown;
  status?: unknown;
}

interface SubscriptionsResponse {
  MediaContainer: { MediaSubscription?: unknown };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SUBSCRIPTIONS_PATH = "/media/subscriptions";

const DVR_NOT_CONFIGURED =
  "DVR is not configured on this Plex server, or no DVR device is paired. " +
  "Set up a tuner with DVR capability in Plex settings (Settings → Live TV & DVR).";

function formatTimestamp(epoch: number): string {
  return new Date(epoch * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function formatSubscription(s: DvrSubscription): string {
  const id = String(s.id ?? "?");
  const title = String(s.title ?? "Unknown");
  const type = s.type ? ` [${s.type}]` : "";
  const channel = s.channelTitle ? `\n  Channel: ${s.channelTitle}` : "";
  const timeRange = s.startTime
    ? `\n  Starts: ${formatTimestamp(Number(s.startTime))}${s.endTime ? ` → ${formatTimestamp(Number(s.endTime))}` : ""}`
    : "";
  const status = s.status ? `\n  Status: ${s.status}` : "";
  const padStart = s.startTimeOffset ? `\n  Pre-roll: ${Math.abs(Number(s.startTimeOffset))}s` : "";
  const padEnd = s.endTimeOffset ? `\n  Post-roll: ${s.endTimeOffset}s` : "";
  return `[${id}] ${title}${type}${channel}${timeRange}${status}${padStart}${padEnd}`;
}

// Plex may return MediaSubscription as an array or a bare object (single item).
function normaliseSubscriptions(raw: unknown): DvrSubscription[] {
  if (Array.isArray(raw)) return raw as DvrSubscription[];
  if (raw && typeof raw === "object") return [raw as DvrSubscription];
  return [];
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerDvrTools(server: McpServer, client: IPlexClient): void {
  server.tool(
    "get_scheduled_recordings",
    "List all DVR recording subscriptions — scheduled one-time recordings and series season passes — with their IDs, channels, and air times. The subscription ID is needed to cancel a recording.",
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
        const header = `Scheduled recordings (${subs.length})\n\n`;
        const body = subs.map(formatSubscription).join("\n\n");
        return { content: [{ type: "text", text: header + body }] };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "schedule_recording",
    "Schedule a DVR recording for a specific program. Use get_live_tv_guide to find the program_id and channel_id, then call this tool to record it. Returns a subscription ID you can use with cancel_recording.",
    {
      program_id: z
        .string()
        .min(1)
        .max(500)
        .describe(
          "Program ID from get_live_tv_guide (the program_id value shown under each program)"
        ),
      channel_id: z
        .string()
        .min(1)
        .max(500)
        .describe(
          "Channel ID from get_live_tv_guide (the channel_id value shown in the channel header)"
        ),
      start_offset_seconds: z
        .number()
        .int()
        .min(0)
        .max(600)
        .optional()
        .describe("Start recording this many seconds early (0–600). Default 0."),
      end_offset_seconds: z
        .number()
        .int()
        .min(0)
        .max(3600)
        .optional()
        .describe("Keep recording this many seconds past the end time (0–3600). Default 0."),
    },
    async (args) => {
      const params: Record<string, string> = {
        programKey: args.program_id,
        channelKey: args.channel_id,
      };
      if (args.start_offset_seconds !== undefined)
        params.startTimeOffset = String(-args.start_offset_seconds);
      if (args.end_offset_seconds !== undefined)
        params.endTimeOffset = String(args.end_offset_seconds);

      try {
        let data: SubscriptionsResponse;
        try {
          data = await client.post<SubscriptionsResponse>(SUBSCRIPTIONS_PATH, params);
        } catch (err) {
          if (err instanceof PlexApiError && err.status === 404) {
            return { content: [{ type: "text", text: DVR_NOT_CONFIGURED }] };
          }
          throw err;
        }
        const subs = normaliseSubscriptions(data.MediaContainer?.MediaSubscription);
        const sub = subs[0];
        if (!sub) {
          return {
            content: [
              {
                type: "text",
                text: "Recording scheduled but Plex returned no subscription details.",
              },
            ],
          };
        }
        const lines = [
          `Recording scheduled.`,
          `Subscription ID: ${sub.id ?? "unknown"} (use this to cancel)`,
        ];
        if (sub.title) lines.push(`Title: ${sub.title}`);
        if (sub.channelTitle) lines.push(`Channel: ${sub.channelTitle}`);
        if (sub.startTime) lines.push(`Starts: ${formatTimestamp(Number(sub.startTime))}`);
        if (sub.endTime) lines.push(`Ends: ${formatTimestamp(Number(sub.endTime))}`);
        return { content: [{ type: "text", text: lines.join("\n") }] };
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
        await client.delete<unknown>(`${SUBSCRIPTIONS_PATH}/${args.subscription_id}`);
        return {
          content: [
            {
              type: "text",
              text: `Recording subscription ${args.subscription_id} cancelled.`,
            },
          ],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );
}
