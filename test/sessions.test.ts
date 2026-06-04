import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerSessionTools } from "../src/tools/sessions.js";
import { makeMockClient, callTool, type RegisterFn } from "./helpers.js";

const register: RegisterFn = registerSessionTools;

// ── get_active_sessions ───────────────────────────────────────────────────────

describe("get_active_sessions", () => {
  it("returns no-sessions message when empty", async () => {
    const client = makeMockClient();
    client.setResponse("/status/sessions", { MediaContainer: { Metadata: [] } });
    const { text, isError } = await callTool(register, "get_active_sessions", {}, client);
    assert.equal(isError, false);
    assert.match(text, /No active sessions/);
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

  it("returns transcode session list", async () => {
    const client = makeMockClient();
    client.setResponse("/transcode/sessions", {
      MediaContainer: {
        TranscodeSession: [
          {
            key: "abc123",
            videoDecision: "transcode",
            audioDecision: "copy",
            progress: 45.5,
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
    const { text, isError } = await callTool(register, "get_transcode_sessions", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Transcode sessions \(1\)/);
    assert.match(text, /abc123/);
    assert.match(text, /video=transcode/);
    assert.match(text, /audio=copy/);
    assert.match(text, /46%/);
    assert.match(text, /4\.2x/);
    assert.match(text, /hevc \/ ac3/);
    assert.match(text, /h264 \/ aac/);
    assert.match(text, /HW: partial/);
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

  it("handles session with no optional fields", async () => {
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
    assert.match(text, /bare/);
    assert.doesNotMatch(text, /HW/);
    assert.doesNotMatch(text, /Source/);
  });

  it("returns error on API failure", async () => {
    const client = makeMockClient();
    client.setError("/transcode/sessions", 500, "Internal error");
    const { isError } = await callTool(register, "get_transcode_sessions", {}, client);
    assert.equal(isError, true);
  });
});
