import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerDvrTools } from "../src/tools/dvr.js";
import { makeMockClient, callTool, type RegisterFn } from "./helpers.js";

const register: RegisterFn = registerDvrTools;

const SUBSCRIPTION = {
  id: "42",
  title: "National Treasure",
  type: "oneShot",
  channelTitle: "TNT",
  channelKey: "/livetv/channels/ch-tnt",
  startTime: 1717200000,
  endTime: 1717207200,
  status: "scheduled",
};

// ── get_scheduled_recordings ──────────────────────────────────────────────────

describe("get_scheduled_recordings", () => {
  it("returns scheduled recordings list", async () => {
    const client = makeMockClient();
    client.setResponse("/dvr/subscriptions", {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    const { text, isError } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Scheduled recordings \(1\)/);
    assert.match(text, /\[42\] National Treasure/);
    assert.match(text, /\[oneShot\]/);
    assert.match(text, /TNT/);
    assert.match(text, /Status: scheduled/);
    assert.match(text, /Starts:/);
  });

  it("returns no-recordings message when empty", async () => {
    const client = makeMockClient();
    client.setResponse("/dvr/subscriptions", {
      MediaContainer: { MediaSubscription: [] },
    });
    const { text, isError } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.equal(isError, false);
    assert.match(text, /No scheduled recordings/);
  });

  it("handles subscription with no optional fields", async () => {
    const client = makeMockClient();
    client.setResponse("/dvr/subscriptions", {
      MediaContainer: { MediaSubscription: [{ id: "1", title: "Bare" }] },
    });
    const { text, isError } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Bare/);
    assert.doesNotMatch(text, /Channel:/);
    assert.doesNotMatch(text, /Status:/);
  });

  it("shows pre-roll and post-roll offsets when present", async () => {
    const client = makeMockClient();
    client.setResponse("/dvr/subscriptions", {
      MediaContainer: {
        MediaSubscription: [{ id: "5", title: "Movie", startTimeOffset: -30, endTimeOffset: 60 }],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /Pre-roll: -30s/);
    assert.match(text, /Post-roll: 60s/);
  });

  it("returns error on API failure", async () => {
    const client = makeMockClient();
    client.setError("/dvr/subscriptions", 503, "DVR unavailable");
    const { isError } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.equal(isError, true);
  });
});

// ── schedule_recording ────────────────────────────────────────────────────────

describe("schedule_recording", () => {
  it("schedules a recording and returns subscription details", async () => {
    const client = makeMockClient();
    client.setResponse("/dvr/subscriptions", {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    const { text, isError } = await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", channel_id: "/livetv/channels/ch-tnt" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /Recording scheduled/);
    assert.match(text, /Subscription ID: 42/);
    assert.match(text, /National Treasure/);
    assert.match(text, /TNT/);
    assert.match(text, /Starts:/);
    assert.match(text, /Ends:/);
  });

  it("handles response with no subscription object", async () => {
    const client = makeMockClient();
    client.setResponse("/dvr/subscriptions", {
      MediaContainer: { MediaSubscription: [] },
    });
    const { text, isError } = await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", channel_id: "/livetv/channels/ch-tnt" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /no subscription details/);
  });

  it("accepts optional start and end offset parameters", async () => {
    const client = makeMockClient();
    client.setResponse("/dvr/subscriptions", {
      MediaContainer: {
        MediaSubscription: [{ id: "99", title: "Show", channelTitle: "NBC" }],
      },
    });
    const { text, isError } = await callTool(
      register,
      "schedule_recording",
      {
        program_id: "2002",
        channel_id: "/livetv/channels/ch-nbc",
        start_offset_seconds: 30,
        end_offset_seconds: 120,
      },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /Subscription ID: 99/);
  });

  it("returns error on API failure", async () => {
    const client = makeMockClient();
    client.setError("/dvr/subscriptions", 422, "Invalid program");
    const { isError, text } = await callTool(
      register,
      "schedule_recording",
      { program_id: "bad", channel_id: "/livetv/channels/ch-tnt" },
      client
    );
    assert.equal(isError, true);
    assert.match(text, /422/);
  });
});

// ── cancel_recording ──────────────────────────────────────────────────────────

describe("cancel_recording", () => {
  it("cancels a recording successfully", async () => {
    const client = makeMockClient();
    client.setResponse("/dvr/subscriptions/42", { MediaContainer: {} });
    const { text, isError } = await callTool(
      register,
      "cancel_recording",
      { subscription_id: "42" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /42/);
    assert.match(text, /cancelled/);
  });

  it("rejects non-numeric subscription IDs (path traversal guard)", async () => {
    const client = makeMockClient();
    const { isError } = await callTool(
      register,
      "cancel_recording",
      { subscription_id: "../secrets" },
      client
    );
    // Zod validation rejects non-numeric — MCP returns an error
    assert.equal(isError, true);
  });

  it("rejects subscription IDs with slashes", async () => {
    const client = makeMockClient();
    const { isError } = await callTool(
      register,
      "cancel_recording",
      { subscription_id: "1/2" },
      client
    );
    assert.equal(isError, true);
  });

  it("returns error on API failure (e.g. subscription not found)", async () => {
    const client = makeMockClient();
    client.setError("/dvr/subscriptions/999", 404, "Subscription not found");
    const { isError, text } = await callTool(
      register,
      "cancel_recording",
      { subscription_id: "999" },
      client
    );
    assert.equal(isError, true);
    assert.match(text, /404/);
  });
});

// ── PlexClient post/delete (via plex-client.test.ts mock approach) ────────────

describe("dvr formatting edge cases", () => {
  it("formatSubscription: missing id shows ? placeholder", async () => {
    const client = makeMockClient();
    client.setResponse("/dvr/subscriptions", {
      MediaContainer: { MediaSubscription: [{ title: "No ID Show" }] },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /\[\?\]/);
  });

  it("schedule_recording: subscription missing startTime/endTime omits those lines", async () => {
    const client = makeMockClient();
    client.setResponse("/dvr/subscriptions", {
      MediaContainer: {
        MediaSubscription: [{ id: "7", title: "Sparse" }],
      },
    });
    const { text } = await callTool(
      register,
      "schedule_recording",
      { program_id: "5", channel_id: "/livetv/channels/ch-x" },
      client
    );
    assert.doesNotMatch(text, /Starts:/);
    assert.doesNotMatch(text, /Ends:/);
  });
});
