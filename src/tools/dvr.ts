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

interface EpgProvider {
  identifier?: unknown;
  id?: unknown;
}

interface DvrProvidersResponse {
  MediaContainer: { MediaProvider?: EpgProvider[] };
}

interface TemplateResponse {
  MediaContainer?: {
    SubscriptionTemplate?: Array<{
      MediaSubscription?: Array<{ targetLibrarySectionID?: unknown }>;
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
    [
      "Schedule a one-shot DVR recording for a specific program.",
      "Use get_live_tv_guide to obtain program_id, program_title, program_type, and channel_id, then pass them here.",
      "Returns a subscription ID you can use with cancel_recording.",
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
        .enum(["movie", "episode"])
        .optional()
        .describe("program_type from get_live_tv_guide. Default: movie."),
      channel_id: z
        .string()
        .min(1)
        .max(500)
        .optional()
        .describe("channel_id from get_live_tv_guide — improves airing matching"),
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
      debug: z
        .union([z.boolean(), z.string().transform((v) => v === "true")])
        .optional()
        .describe(
          "Show all POST params and the full Plex error response. Use this to diagnose 400 errors."
        ),
    },
    async (args) => {
      try {
        // 1. Fetch EPG provider numeric ID from /media/providers.
        let providerId: number;
        try {
          const providers = await client.get<DvrProvidersResponse>("/media/providers");
          const epgProvider = (providers.MediaContainer?.MediaProvider ?? []).find((p) =>
            String(p.identifier ?? "").includes("epg")
          );
          if (!epgProvider || epgProvider.id == null) {
            return { content: [{ type: "text", text: DVR_NOT_CONFIGURED }] };
          }
          providerId = Number(epgProvider.id);
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
        try {
          const tmpl = await client.get<TemplateResponse>("/media/subscriptions/template", {
            guid: programGuid,
          });
          const sub = tmpl.MediaContainer?.SubscriptionTemplate?.[0]?.MediaSubscription?.[0];
          if (sub?.targetLibrarySectionID != null) {
            sectionId = Number(sub.targetLibrarySectionID);
          }
        } catch {
          // Continue without section ID.
        }

        // 4. Map content type: movie=1, episode=4.
        const contentType = args.program_type === "episode" ? "4" : "1";

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
          if (args.debug) dvrRaw = JSON.stringify(dvrs.MediaContainer, null, 2).slice(0, 1500);
        } catch {
          // Continue without DVR device info.
        }

        // 7. Build the POST params.
        const params: Record<string, string> = {
          type: contentType,
          includeGrabs: "1",
          "params[mediaProviderID]": String(providerId),
          "params[libraryType]": contentType,
          "prefs[oneShot]": "true",
          "prefs[recordPartials]": "false",
          "prefs[startOffsetMinutes]": String(startMin),
          "prefs[endOffsetMinutes]": String(endMin),
          "prefs[remoteMedia]": "false",
          "hints[type]": contentType,
          "hints[ratingKey]": programGuid,
          "hints[guid]": programGuid,
        };
        if (args.program_title) params["hints[title]"] = args.program_title;
        if (args.channel_id) params["params[airingChannels]"] = args.channel_id;
        if (dvrSectionLocationId !== undefined)
          params["targetSectionLocationID"] = dvrSectionLocationId;
        if (dvrDeviceId !== undefined) params["params[deviceID]"] = dvrDeviceId;
        if (dvrDeviceKey !== undefined) params["params[dvrDeviceID]"] = dvrDeviceKey;
        if (sectionId !== undefined) params["targetLibrarySectionID"] = String(sectionId);

        // 8. Collect debug info if requested.
        const debugLines: string[] = [];
        if (args.debug) {
          debugLines.push("=== DEBUG: schedule_recording ===");
          debugLines.push(`providerId: ${providerId}`);
          debugLines.push(`sectionId: ${sectionId ?? "not found"}`);
          debugLines.push(`dvrSectionLocationId: ${dvrSectionLocationId ?? "not found"}`);
          debugLines.push(`dvrDeviceId: ${dvrDeviceId ?? "not found"}`);
          debugLines.push(`dvrDeviceKey: ${dvrDeviceKey ?? "not found"}`);
          if (dvrRaw) debugLines.push(`/livetv/dvrs response:\n${dvrRaw}`);
          debugLines.push("POST params:");
          for (const [k, v] of Object.entries(params)) {
            debugLines.push(`  ${k} = ${v}`);
          }
          debugLines.push("=================================");
        }

        // 9. POST the subscription.
        let data: SubscriptionsResponse;
        try {
          data = await client.post<SubscriptionsResponse>(SUBSCRIPTIONS_PATH, params);
        } catch (err) {
          if (args.debug && err instanceof PlexApiError) {
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
                text: args.debug ? debugLines.join("\n") + "\n\n" + noSubMsg : noSubMsg,
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
        const body = lines.join("\n");
        return {
          content: [
            {
              type: "text",
              text: args.debug ? debugLines.join("\n") + "\n\n" + body : body,
            },
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
