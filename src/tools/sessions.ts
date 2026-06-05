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
  key?: unknown;
  videoDecision?: unknown;
  audioDecision?: unknown;
  throttled?: unknown;
}

interface SessionMetadata {
  title?: unknown;
  type?: unknown;
  year?: unknown;
  grandparentTitle?: unknown;
  parentTitle?: unknown;
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
  title?: unknown;
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

function sessionTitle(s: SessionMetadata): string {
  const title = String(s.title ?? "Unknown");
  if (s.grandparentTitle) {
    const se =
      (s.parentIndex !== undefined ? `S${s.parentIndex}` : "") +
      (s.index !== undefined ? `E${s.index}` : "");
    return `${s.grandparentTitle}${se ? ` ${se}` : ""}: ${title}`;
  }
  return title + (s.year ? ` (${s.year})` : "");
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

// Resolve output codec: prefer explicit value, fall back to source for copy, else "unknown".
// Never return "*" which Plex uses as a wildcard placeholder.
function resolveCodec(decision: string, outputCodec: unknown, sourceCodec: unknown): string {
  const out = outputCodec ? String(outputCodec) : "";
  const src = sourceCodec ? String(sourceCodec) : "";
  if (out && out !== "*") return out;
  if (decision === "copy" && src && src !== "*") return src;
  return "unknown";
}

function formatTranscodeSession(
  ts: TranscodeSession,
  playback: SessionMetadata | undefined
): string {
  const key = String(ts.key ?? "?");
  const isRecording = playback === undefined;
  const sessionType = isRecording ? "Recording" : "Playback";
  const vd = String(ts.videoDecision ?? "?");
  const ad = String(ts.audioDecision ?? "?");
  const progress = ts.progress !== undefined ? ` ${Math.round(Number(ts.progress))}%` : "";
  const speed = ts.speed !== undefined ? ` @ ${Number(ts.speed).toFixed(1)}x` : "";
  const throttled = ts.throttled ? " [throttled]" : "";

  const srcVid =
    ts.sourceVideoCodec && String(ts.sourceVideoCodec) !== "*"
      ? String(ts.sourceVideoCodec)
      : undefined;
  const srcAud =
    ts.sourceAudioCodec && String(ts.sourceAudioCodec) !== "*"
      ? String(ts.sourceAudioCodec)
      : undefined;

  const outVid = resolveCodec(vd, ts.videoCodec, ts.sourceVideoCodec);
  const outAud = resolveCodec(ad, ts.audioCodec, ts.sourceAudioCodec);

  const src = srcVid || srcAud ? `\n  Source: ${srcVid ?? "unknown"} / ${srcAud ?? "unknown"}` : "";
  const out = `\n  Output: ${outVid} / ${outAud}`;

  const hw = ts.transcodeHwFullPipeline
    ? "\n  HW: full pipeline"
    : ts.transcodeHwRequested
      ? "\n  HW: partial"
      : "";

  const extra: string[] = [];
  if (isRecording) {
    if (ts.title) extra.push(`\n  Title: ${ts.title}`);
  } else if (playback) {
    extra.push(`\n  Title: ${sessionTitle(playback)}`);
    if (playback.User?.title) extra.push(`\n  User: ${playback.User.title}`);
    if (playback.Player?.title) extra.push(`\n  Client: ${playback.Player.title}`);
  }

  return `[${key}] TYPE: ${sessionType} | video=${vd}, audio=${ad}${progress}${speed}${throttled}${extra.join("")}${src}${out}${hw}`;
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerSessionTools(server: McpServer, client: IPlexClient): void {
  server.tool(
    "get_active_sessions",
    "List all currently active Plex playback sessions — who is watching what, on which device, with playback progress and stream decision (direct play vs transcode). Does not include DVR recordings; those appear in get_activities.",
    {},
    async () => {
      try {
        const data = await client.get<SessionsResponse>("/status/sessions");
        const sessions = data.MediaContainer?.Metadata ?? [];
        if (sessions.length === 0) {
          let msg =
            "No active playback sessions. Note: DVR recordings appear in get_activities, not here.";
          try {
            const td = await client.get<TranscodeSessionsResponse>("/transcode/sessions");
            const count = (td.MediaContainer?.TranscodeSession ?? []).length;
            if (count > 0) {
              msg = `No active playback sessions. There are ${count} active transcode session(s) (possibly recordings) — see get_transcode_sessions or get_activities for details.`;
            }
          } catch {
            // Transcode check is best-effort; fall through to default message.
          }
          return { content: [{ type: "text", text: msg }] };
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
    "List active Plex transcode sessions. Each session is labeled as Recording (DVR) or Playback (streaming). Includes codec decisions, source/output codecs, progress, speed, and hardware acceleration status.",
    {},
    async () => {
      try {
        const data = await client.get<TranscodeSessionsResponse>("/transcode/sessions");
        const sessions = data.MediaContainer?.TranscodeSession ?? [];
        if (sessions.length === 0) {
          return { content: [{ type: "text", text: "No active transcode sessions." }] };
        }

        // Cross-reference with playback sessions to classify Recording vs Playback.
        // Transcode sessions without a matching playback session are DVR recordings.
        const playbackByKey = new Map<string, SessionMetadata>();
        try {
          const sessData = await client.get<SessionsResponse>("/status/sessions");
          for (const s of sessData.MediaContainer?.Metadata ?? []) {
            const k = s.TranscodeSession?.key;
            if (k != null) playbackByKey.set(String(k), s);
          }
        } catch {
          // Cross-reference is best-effort; unmatched sessions are labeled Recording.
        }

        const header = `Transcode sessions (${sessions.length})\n\n`;
        const body = sessions
          .map((ts) => formatTranscodeSession(ts, playbackByKey.get(String(ts.key ?? ""))))
          .join("\n\n");
        return { content: [{ type: "text", text: header + body }] };
      } catch (err) {
        return toolError(err);
      }
    }
  );
}
