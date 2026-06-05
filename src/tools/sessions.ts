import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IPlexClient } from "../plex-client.js";
import { toolError } from "./shared.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface PlexUser {
  title?: unknown;
}

interface PlexPlayer {
  title?: unknown;
  platform?: unknown;
  state?: unknown;
}

interface PlexTranscodeSession {
  videoDecision?: unknown;
  audioDecision?: unknown;
  throttled?: unknown;
}

interface SessionMetadata {
  title?: unknown;
  type?: unknown;
  year?: unknown;
  grandparentTitle?: unknown;
  parentIndex?: unknown;
  index?: unknown;
  duration?: unknown;
  viewOffset?: unknown;
  User?: PlexUser;
  Player?: PlexPlayer;
  TranscodeSession?: PlexTranscodeSession;
}

interface SessionsResponse {
  MediaContainer: { Metadata?: SessionMetadata[] };
}

interface TranscodeSession {
  key?: unknown;
  throttled?: unknown;
  progress?: unknown;
  speed?: unknown;
  sourceVideoCodec?: unknown;
  sourceAudioCodec?: unknown;
  videoDecision?: unknown;
  audioDecision?: unknown;
  subtitleDecision?: unknown;
  videoCodec?: unknown;
  audioCodec?: unknown;
  transcodeHwRequested?: unknown;
  transcodeHwFullPipeline?: unknown;
}

interface TranscodeSessionsResponse {
  MediaContainer: { TranscodeSession?: TranscodeSession[] };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function msToTime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function formatSession(s: SessionMetadata): string {
  const title = String(s.title ?? "Unknown");
  const type = String(s.type ?? "?");
  const year = s.year ? ` (${s.year})` : "";

  const episodePrefix = s.grandparentTitle
    ? `${s.grandparentTitle}` +
      (s.parentIndex !== undefined ? ` S${s.parentIndex}` : "") +
      (s.index !== undefined ? `E${s.index}` : "") +
      ": "
    : "";

  const user = s.User?.title ? `  User: ${s.User.title}` : "";
  const device = s.Player?.title
    ? `\n  Device: ${s.Player.title}` + (s.Player.platform ? ` (${s.Player.platform})` : "")
    : "";
  const state = s.Player?.state ? `\n  State: ${String(s.Player.state)}` : "";

  const viewOffset = s.viewOffset !== undefined ? Number(s.viewOffset) : undefined;
  const duration = s.duration !== undefined ? Number(s.duration) : undefined;
  let progress = "";
  if (viewOffset !== undefined && duration !== undefined && duration > 0) {
    const pct = Math.round((viewOffset / duration) * 100);
    progress = `\n  Progress: ${msToTime(viewOffset)} / ${msToTime(duration)} (${pct}%)`;
  }

  let transcode = "";
  const ts = s.TranscodeSession;
  if (ts) {
    const vd = String(ts.videoDecision ?? "unknown");
    const ad = String(ts.audioDecision ?? "unknown");
    transcode = `\n  Stream: video=${vd}, audio=${ad}`;
    if (ts.throttled) transcode += " [throttled]";
  }

  return `${episodePrefix}${title}${year} [${type}]\n${user}${device}${state}${progress}${transcode}`;
}

function formatTranscodeSession(ts: TranscodeSession): string {
  const key = String(ts.key ?? "?");
  const vd = String(ts.videoDecision ?? "?");
  const ad = String(ts.audioDecision ?? "?");
  const progress = ts.progress !== undefined ? ` ${Math.round(Number(ts.progress))}%` : "";
  const speed = ts.speed !== undefined ? ` @ ${Number(ts.speed).toFixed(1)}x` : "";
  const throttled = ts.throttled ? " [throttled]" : "";

  const src =
    ts.sourceVideoCodec && ts.sourceAudioCodec
      ? `\n  Source: ${ts.sourceVideoCodec} / ${ts.sourceAudioCodec}`
      : "";
  const out =
    ts.videoCodec && ts.audioCodec ? `\n  Output: ${ts.videoCodec} / ${ts.audioCodec}` : "";
  const hw = ts.transcodeHwFullPipeline
    ? "\n  HW: full pipeline"
    : ts.transcodeHwRequested
      ? "\n  HW: partial"
      : "";

  return `[${key}] video=${vd}, audio=${ad}${progress}${speed}${throttled}${src}${out}${hw}`;
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerSessionTools(server: McpServer, client: IPlexClient): void {
  server.tool(
    "get_active_sessions",
    "List all currently active Plex playback sessions — who is watching what, on which device, with playback progress and stream decision (direct play vs transcode).",
    {},
    async () => {
      try {
        const data = await client.get<SessionsResponse>("/status/sessions");
        const sessions = data.MediaContainer?.Metadata ?? [];
        if (sessions.length === 0) {
          return { content: [{ type: "text", text: "No active sessions." }] };
        }
        const header = `Active sessions (${sessions.length})\n\n`;
        const body = sessions.map(formatSession).join("\n\n");
        return { content: [{ type: "text", text: header + body }] };
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.tool(
    "get_transcode_sessions",
    "List active Plex transcode sessions with codec decisions, progress, speed, and hardware acceleration status.",
    {},
    async () => {
      try {
        const data = await client.get<TranscodeSessionsResponse>("/transcode/sessions");
        const sessions = data.MediaContainer?.TranscodeSession ?? [];
        if (sessions.length === 0) {
          return { content: [{ type: "text", text: "No active transcode sessions." }] };
        }
        const header = `Transcode sessions (${sessions.length})\n\n`;
        const body = sessions.map(formatTranscodeSession).join("\n\n");
        return { content: [{ type: "text", text: header + body }] };
      } catch (err) {
        return toolError(err);
      }
    }
  );
}
