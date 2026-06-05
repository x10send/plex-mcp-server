import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type IPlexClient, PlexApiError } from "../plex-client.js";

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
  MediaContainer: { MediaSubscription?: DvrSubscription[] };
}

interface CreateResponse {
  MediaContainer: { MediaSubscription?: DvrSubscription[] };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toolError(err: unknown): { content: [{ type: "text"; text: string }]; isError: true } {
  const msg =
    err instanceof PlexApiError
      ? `Plex API error ${err.status}: ${err.message.slice(0, 200)}`
      : "Unexpected error contacting Plex";
  return { content: [{ type: "text", text: msg }], isError: true };
}

function formatTimestamp(epoch: number): string {
  return new Date(epoch * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function formatSubscription(s: DvrSubscription): string {
  const id = String(s.id ?? "?");
  const title = String(s.title ?? "Unknown");
  const type = s.type ? ` [${s.type}]` : "";
  const channel = s.channelTitle ? `\n  Channel: ${s.channelTitle}` : "";
  const start = s.startTime ? `\n  Starts: ${formatTimestamp(Number(s.startTime))}` : "";
  const end = s.endTime ? ` → ${formatTimestamp(Number(s.endTime))}` : "";
  const status = s.status ? `\n  Status: ${s.status}` : "";
  const padStart = s.startTimeOffset ? `\n  Pre-roll: ${s.startTimeOffset}s` : "";
  const padEnd = s.endTimeOffset ? `\n  Post-roll: ${s.endTimeOffset}s` : "";
  return `[${id}] ${title}${type}${channel}${start}${end}${status}${padStart}${padEnd}`;
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerDvrTools(server: McpServer, client: IPlexClient): void {
  server.tool(
    "get_scheduled_recordings",
    "List all DVR recording subscriptions — scheduled one-time recordings and series season passes — with their IDs, channels, and air times. The subscription ID is needed to cancel a recording.",
    {},
    async () => {
      try {
        const data = await client.get<SubscriptionsResponse>("/dvr/subscriptions");
        const subs = data.MediaContainer?.MediaSubscription ?? [];
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
        .max(200)
        .describe(
          "Program ID from get_live_tv_guide (the full key path, e.g. /library/metadata/12345)"
        ),
      channel_id: z
        .string()
        .min(1)
        .max(500)
        .describe("Channel key from get_live_tv_guide (e.g. /livetv/channels/abc123)"),
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
        const data = await client.post<CreateResponse>("/dvr/subscriptions", params);
        const sub = data.MediaContainer?.MediaSubscription?.[0];
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
        // Restrict to digits only — Plex subscription IDs are always numeric,
        // and this prevents any path traversal in the DELETE URL.
        .regex(/^\d+$/, "Subscription ID must be a positive integer")
        .describe("Subscription ID from get_scheduled_recordings or schedule_recording"),
    },
    async (args) => {
      try {
        await client.delete<unknown>(`/dvr/subscriptions/${args.subscription_id}`);
        return {
          content: [
            { type: "text", text: `Recording subscription ${args.subscription_id} cancelled.` },
          ],
        };
      } catch (err) {
        return toolError(err);
      }
    }
  );
}
