import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerSessionTools } from "../src/tools/sessions.js";
import { makeMockClient, callTool, type RegisterFn } from "./helpers.js";

const register: RegisterFn = registerSessionTools;

// ── get_active_sessions ───────────────────────────────────────────────────────

describe("get_active_sessions", () => {
  it("returns no-sessions message when empty and no transcode sessions", async () => {
    const client = makeMockClient();
    client.setResponse("/status/sessions", { MediaContainer: { Metadata: [] } });
    client.setResponse("/transcode/sessions", { MediaContainer: { TranscodeSession: [] } });
    const { text, isError } = await callTool(register, "get_active_sessions", {}, client);
    assert.equal(isError, false);
    assert.match(text, /No active playback sessions/);
    assert.match(text, /get_activities/);
  });

  it("shows transcode hint when playback empty but transcode sessions exist", async () => {
    const client = makeMockClient();
    client.setResponse("/status/sessions", { MediaContainer: { Metadata: [] } });
    client.setResponse("/transcode/sessions", {
      MediaContainer: {
        TranscodeSession: [
          { key: "rec1", videoDecision: "copy", audioDecision: "copy" },
          { key: "rec2", videoDecision: "copy", audioDecision: "copy" },
        ],
      },
    });
    const { text, isError } = await callTool(register, "get_active_sessions", {}, client);
    assert.equal(isError, false);
    assert.match(text, /No active playback sessions/);
    assert.match(text, /2 active transcode session/);
    assert.match(text, /get_transcode_sessions/);
  });

  it("falls back to default message when transcode check fails", async () => {
    const client = makeMockClient();
    client.setResponse("/status/sessions", { MediaContainer: { Metadata: [] } });
    // No /transcode/sessions mock → mock throws → caught silently
    const { text, isError } = await callTool(register, "get_active_sessions", {}, client);
    assert.equal(isError, false);
    assert.match(text, /No active playback sessions/);
  });

  it("returns session list with user and device", async () => {
    const client = makeMockClient();
    client.setResponse("/status/sessions", {
      MediaContainer: {
        Metadata: [
          {
            title: "Inception",
            type: "movie",
            year: 2010,
            viewOffset: 3000000,
            duration: 9000000,
            User: { title: "adam" },
            Player: { title: "Living Room TV", platform: "Android TV", state: "playing" },
          },
        ],
      },
    });
    const { text, isError } = await callTool(register, "get_active_sessions", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Active sessions \(1\)/);
    assert.match(text, /Inception/);
    assert.match(text, /adam/);
    assert.match(text, /Living Room TV/);
    assert.match(text, /Android TV/);
    assert.match(text, /playing/);
    assert.match(text, /33%/);
  });

  it("formats episode session with show prefix", async () => {
    const client = makeMockClient();
    client.setResponse("/status/sessions", {
      MediaContainer: {
        Metadata: [
          {
            title: "Pilot",
            type: "episode",
            grandparentTitle: "Breaking Bad",
            parentIndex: 1,
            index: 1,
            viewOffset: 600000,
            duration: 2700000,
            User: { title: "adam" },
            Player: { title: "iPad", platform: "iOS", state: "paused" },
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_active_sessions", {}, client);
    assert.match(text, /Breaking Bad S1E1: Pilot/);
    assert.match(text, /paused/);
  });

  it("shows transcode decision when TranscodeSession present", async () => {
    const client = makeMockClient();
    client.setResponse("/status/sessions", {
      MediaContainer: {
        Metadata: [
          {
            title: "Dune",
            type: "movie",
            User: { title: "adam" },
            Player: { title: "Browser", platform: "Chrome", state: "playing" },
            TranscodeSession: {
              videoDecision: "transcode",
              audioDecision: "copy",
              throttled: false,
            },
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_active_sessions", {}, client);
    assert.match(text, /video=transcode/);
    assert.match(text, /audio=copy/);
    assert.doesNotMatch(text, /throttled/);
  });

  it("shows throttled flag when transcode is throttled", async () => {
    const client = makeMockClient();
    client.setResponse("/status/sessions", {
      MediaContainer: {
        Metadata: [
          {
            title: "Dune",
            type: "movie",
            User: { title: "adam" },
            Player: { title: "Browser", platform: "Chrome", state: "playing" },
            TranscodeSession: {
              videoDecision: "transcode",
              audioDecision: "copy",
              throttled: true,
            },
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_active_sessions", {}, client);
    assert.match(text, /\[throttled\]/);
  });

  it("handles session with duration > 1 hour (exercises hours branch in msToTime)", async () => {
    const client = makeMockClient();
    client.setResponse("/status/sessions", {
      MediaContainer: {
        Metadata: [
          {
            title: "Long Movie",
            type: "movie",
            viewOffset: 3700000,
            duration: 7200000,
            User: { title: "adam" },
            Player: { title: "TV", platform: "Roku", state: "playing" },
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_active_sessions", {}, client);
    assert.match(text, /1h/);
    assert.match(text, /51%/);
  });

  it("handles session with no User or Player gracefully", async () => {
    const client = makeMockClient();
    client.setResponse("/status/sessions", {
      MediaContainer: {
        Metadata: [{ title: "Minimal", type: "movie" }],
      },
    });
    const { text, isError } = await callTool(register, "get_active_sessions", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Minimal/);
  });

  it("handles session with no viewOffset or duration (no progress line)", async () => {
    const client = makeMockClient();
    client.setResponse("/status/sessions", {
      MediaContainer: {
        Metadata: [
          {
            title: "No Progress",
            type: "movie",
            User: { title: "adam" },
            Player: { title: "TV", platform: "Roku", state: "playing" },
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_active_sessions", {}, client);
    assert.doesNotMatch(text, /Progress:/);
  });

  it("returns error on API failure", async () => {
    const client = makeMockClient();
    client.setError("/status/sessions", 500, "Internal error");
    const { isError } = await callTool(register, "get_active_sessions", {}, client);
    assert.equal(isError, true);
  });
});

// ── get_transcode_sessions ────────────────────────────────────────────────────

describe("get_transcode_sessions", () => {
  it("returns no-sessions message when empty", async () => {
    const client = makeMockClient();
    client.setResponse("/transcode/sessions", { MediaContainer: { TranscodeSession: [] } });
    const { text, isError } = await callTool(register, "get_transcode_sessions", {}, client);
    assert.equal(isError, false);
    assert.match(text, /No active transcode sessions/);
  });

  it("labels unmatched sessions as Recording", async () => {
    const client = makeMockClient();
    client.setResponse("/transcode/sessions", {
      MediaContainer: {
        TranscodeSession: [
          {
            key: "rec1",
            videoDecision: "copy",
            audioDecision: "copy",
            progress: 9,
            title: "Joe Kidd (1972)",
            sourceVideoCodec: "mpeg2video",
            sourceAudioCodec: "ac3",
            videoCodec: "*",
            audioCodec: "*",
          },
        ],
      },
    });
    // No /status/sessions mock → cross-reference throws → all labeled Recording
    const { text, isError } = await callTool(register, "get_transcode_sessions", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Transcode sessions \(1\)/);
    assert.match(text, /TYPE: Recording/);
    assert.match(text, /video=copy/);
    assert.match(text, /9%/);
    assert.match(text, /Joe Kidd/);
  });

  it("labels matched sessions as Playback with user and client", async () => {
    const client = makeMockClient();
    client.setResponse("/transcode/sessions", {
      MediaContainer: {
        TranscodeSession: [
          {
            key: "ts-abc",
            videoDecision: "transcode",
            audioDecision: "copy",
            progress: 34,
            speed: 4.2,
            sourceVideoCodec: "hevc",
            sourceAudioCodec: "ac3",
            videoCodec: "h264",
            audioCodec: "aac",
            transcodeHwRequested: true,
            transcodeHwFullPipeline: false,
          },
        ],
      },
    });
    client.setResponse("/status/sessions", {
      MediaContainer: {
        Metadata: [
          {
            title: "Inception",
            type: "movie",
            year: 2010,
            User: { title: "adam" },
            Player: { title: "Apple TV", platform: "tvOS" },
            TranscodeSession: { key: "ts-abc" },
          },
        ],
      },
    });
    const { text, isError } = await callTool(register, "get_transcode_sessions", {}, client);
    assert.equal(isError, false);
    assert.match(text, /TYPE: Playback/);
    assert.match(text, /Inception/);
    assert.match(text, /adam/);
    assert.match(text, /Apple TV/);
    assert.match(text, /video=transcode/);
    assert.match(text, /34%/);
    assert.match(text, /4\.2x/);
    assert.match(text, /HW: partial/);
  });

  it("resolves * output codec to source codec for copy decision", async () => {
    const client = makeMockClient();
    client.setResponse("/transcode/sessions", {
      MediaContainer: {
        TranscodeSession: [
          {
            key: "r1",
            videoDecision: "copy",
            audioDecision: "copy",
            sourceVideoCodec: "mpeg2video",
            sourceAudioCodec: "ac3",
            videoCodec: "*",
            audioCodec: "*",
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_transcode_sessions", {}, client);
    assert.match(text, /Source: mpeg2video \/ ac3/);
    assert.match(text, /Output: mpeg2video \/ ac3/);
    assert.doesNotMatch(text, /\*/);
  });

  it("shows 'unknown' for output codec when no source and decision is not copy", async () => {
    const client = makeMockClient();
    client.setResponse("/transcode/sessions", {
      MediaContainer: {
        TranscodeSession: [{ key: "r2", videoDecision: "transcode", audioDecision: "transcode" }],
      },
    });
    const { text } = await callTool(register, "get_transcode_sessions", {}, client);
    assert.match(text, /Output: unknown \/ unknown/);
    assert.doesNotMatch(text, /\*/);
  });

  it("always shows Output line (never omits it)", async () => {
    const client = makeMockClient();
    client.setResponse("/transcode/sessions", {
      MediaContainer: {
        TranscodeSession: [
          { key: "bare", videoDecision: "directplay", audioDecision: "directplay" },
        ],
      },
    });
    const { text, isError } = await callTool(register, "get_transcode_sessions", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Output:/);
    assert.doesNotMatch(text, /HW/);
    assert.doesNotMatch(text, /Source/);
  });

  it("shows full HW pipeline when transcodeHwFullPipeline is true", async () => {
    const client = makeMockClient();
    client.setResponse("/transcode/sessions", {
      MediaContainer: {
        TranscodeSession: [
          {
            key: "xyz",
            videoDecision: "transcode",
            audioDecision: "copy",
            transcodeHwRequested: true,
            transcodeHwFullPipeline: true,
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_transcode_sessions", {}, client);
    assert.match(text, /HW: full pipeline/);
  });

  it("shows throttled flag", async () => {
    const client = makeMockClient();
    client.setResponse("/transcode/sessions", {
      MediaContainer: {
        TranscodeSession: [
          { key: "t1", videoDecision: "transcode", audioDecision: "copy", throttled: true },
        ],
      },
    });
    const { text } = await callTool(register, "get_transcode_sessions", {}, client);
    assert.match(text, /\[throttled\]/);
  });

  it("mixed recording and playback sessions in one response", async () => {
    const client = makeMockClient();
    client.setResponse("/transcode/sessions", {
      MediaContainer: {
        TranscodeSession: [
          { key: "rec", videoDecision: "copy", audioDecision: "copy", progress: 18 },
          { key: "play", videoDecision: "transcode", audioDecision: "copy", progress: 50 },
        ],
      },
    });
    client.setResponse("/status/sessions", {
      MediaContainer: {
        Metadata: [
          {
            title: "Dune",
            type: "movie",
            User: { title: "adam" },
            Player: { title: "TV" },
            TranscodeSession: { key: "play" },
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_transcode_sessions", {}, client);
    assert.match(text, /Transcode sessions \(2\)/);
    assert.match(text, /TYPE: Recording/);
    assert.match(text, /TYPE: Playback/);
  });

  it("returns error on API failure", async () => {
    const client = makeMockClient();
    client.setError("/transcode/sessions", 500, "Internal error");
    const { isError } = await callTool(register, "get_transcode_sessions", {}, client);
    assert.equal(isError, true);
  });
});
