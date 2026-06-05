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

// DVR device discovery response — resolveSubscriptionsBase() calls this first.
// The device key "/livetv/dvr/1" yields subscriptions path "/livetv/dvr/1/subscriptions".
const DVR_DEVICE = {
  MediaContainer: { DVRDevice: [{ key: "/livetv/dvr/1" }] },
};
const SUBS_PATH = "/livetv/dvr/1/subscriptions";

// ── get_scheduled_recordings ──────────────────────────────────────────────────

describe("get_scheduled_recordings", () => {
  it("returns scheduled recordings list", async () => {
    const client = makeMockClient();
    client.setResponse("/livetv/dvr", DVR_DEVICE);
    client.setResponse(SUBS_PATH, {
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
    client.setResponse("/livetv/dvr", DVR_DEVICE);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [] },
    });
    const { text, isError } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.equal(isError, false);
    assert.match(text, /No scheduled recordings/);
  });

  it("handles subscription with no optional fields", async () => {
    const client = makeMockClient();
    client.setResponse("/livetv/dvr", DVR_DEVICE);
    client.setResponse(SUBS_PATH, {
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
    client.setResponse("/livetv/dvr", DVR_DEVICE);
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [{ id: "5", title: "Movie", startTimeOffset: -30, endTimeOffset: 60 }],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /Pre-roll: 30s/);
    assert.match(text, /Post-roll: 60s/);
  });

  it("endTime without startTime does not produce orphaned arrow", async () => {
    const client = makeMockClient();
    client.setResponse("/livetv/dvr", DVR_DEVICE);
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [{ id: "7", title: "Oddity", endTime: 1717207200 }],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.doesNotMatch(text, /→/);
    assert.doesNotMatch(text, /Starts:/);
  });

  it("returns not-configured message when /livetv/dvr returns 404", async () => {
    const client = makeMockClient();
    client.setError("/livetv/dvr", 404, "Not found");
    const { text, isError } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.equal(isError, false);
    assert.match(text, /not configured/i);
  });

  it("returns not-configured when DVR endpoint has no device", async () => {
    const client = makeMockClient();
    client.setResponse("/livetv/dvr", { MediaContainer: { DVRDevice: [] } });
    const { text, isError } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.equal(isError, false);
    assert.match(text, /not configured/i);
  });

  it("returns error on API failure on subscriptions endpoint", async () => {
    const client = makeMockClient();
    client.setResponse("/livetv/dvr", DVR_DEVICE);
    client.setError(SUBS_PATH, 503, "DVR unavailable");
    const { isError } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.equal(isError, true);
  });
});

// ── schedule_recording ────────────────────────────────────────────────────────

describe("schedule_recording", () => {
  it("schedules a recording and returns subscription details", async () => {
    const client = makeMockClient();
    client.setResponse("/livetv/dvr", DVR_DEVICE);
    client.setResponse(SUBS_PATH, {
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
    client.setResponse("/livetv/dvr", DVR_DEVICE);
    client.setResponse(SUBS_PATH, {
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
    client.setResponse("/livetv/dvr", DVR_DEVICE);
    client.setResponse(SUBS_PATH, {
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

  it("returns not-configured message when DVR not available", async () => {
    const client = makeMockClient();
    client.setError("/livetv/dvr", 404, "Not found");
    const { text, isError } = await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", channel_id: "/livetv/channels/ch-tnt" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /not configured/i);
  });

  it("returns error on API failure", async () => {
    const client = makeMockClient();
    client.setResponse("/livetv/dvr", DVR_DEVICE);
    client.setError(SUBS_PATH, 422, "Invalid program");
    const { isError, text } = await callTool(
      register,
      "schedule_recording",
      { program_id: "bad", channel_id: "/livetv/channels/ch-tnt" },
      client
    );
    assert.equal(isError, true);
    assert.match(text, /422/);
  });

  it("sends programKey and channelKey as POST params", async () => {
    const client = makeMockClient();
    client.setResponse("/livetv/dvr", DVR_DEVICE);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      { program_id: "/library/metadata/1001", channel_id: "/livetv/channels/ch-tnt" },
      client
    );
    const params = client.getLastPostParams();
    assert.equal(params?.programKey, "/library/metadata/1001");
    assert.equal(params?.channelKey, "/livetv/channels/ch-tnt");
  });

  it("sends negative startTimeOffset for pre-roll seconds", async () => {
    const client = makeMockClient();
    client.setResponse("/livetv/dvr", DVR_DEVICE);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      {
        program_id: "/library/metadata/1001",
        channel_id: "/livetv/channels/ch-tnt",
        start_offset_seconds: 30,
        end_offset_seconds: 120,
      },
      client
    );
    const params = client.getLastPostParams();
    assert.equal(params?.startTimeOffset, "-30");
    assert.equal(params?.endTimeOffset, "120");
  });
});

// ── cancel_recording ──────────────────────────────────────────────────────────

describe("cancel_recording", () => {
  it("cancels a recording successfully", async () => {
    const client = makeMockClient();
    client.setResponse("/livetv/dvr", DVR_DEVICE);
    client.setResponse(`${SUBS_PATH}/42`, { MediaContainer: {} });
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

  it("returns not-configured message when DVR not available", async () => {
    const client = makeMockClient();
    client.setError("/livetv/dvr", 404, "Not found");
    const { text, isError } = await callTool(
      register,
      "cancel_recording",
      { subscription_id: "42" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /not configured/i);
  });

  it("returns error on API failure (e.g. subscription not found)", async () => {
    const client = makeMockClient();
    client.setResponse("/livetv/dvr", DVR_DEVICE);
    client.setError(`${SUBS_PATH}/999`, 404, "Subscription not found");
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

// ── device.key sanitization ───────────────────────────────────────────────────

describe("device key sanitization", () => {
  it("uses fallback path when device.key contains path traversal", async () => {
    const client = makeMockClient();
    client.setResponse("/livetv/dvr", {
      MediaContainer: { DVRDevice: [{ key: "../../secrets" }] },
    });
    client.setResponse("/livetv/dvr/subscriptions", {
      MediaContainer: { MediaSubscription: [] },
    });
    const { text, isError } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.equal(isError, false);
    assert.match(text, /No scheduled recordings/);
  });

  it("uses fallback path when device.key contains a protocol", async () => {
    const client = makeMockClient();
    client.setResponse("/livetv/dvr", {
      MediaContainer: { DVRDevice: [{ key: "http://evil.example/path" }] },
    });
    client.setResponse("/livetv/dvr/subscriptions", {
      MediaContainer: { MediaSubscription: [] },
    });
    const { text, isError } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.equal(isError, false);
    assert.match(text, /No scheduled recordings/);
  });

  it("accepts a valid device.key starting with /", async () => {
    const client = makeMockClient();
    client.setResponse("/livetv/dvr", {
      MediaContainer: { DVRDevice: [{ key: "/livetv/dvr/42" }] },
    });
    client.setResponse("/livetv/dvr/42/subscriptions", {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    const { text, isError } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.equal(isError, false);
    assert.match(text, /National Treasure/);
  });
});

// ── formatting edge cases ─────────────────────────────────────────────────────

describe("dvr formatting edge cases", () => {
  it("formatSubscription: missing id shows ? placeholder", async () => {
    const client = makeMockClient();
    client.setResponse("/livetv/dvr", DVR_DEVICE);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [{ title: "No ID Show" }] },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /\[\?\]/);
  });

  it("schedule_recording: subscription missing startTime/endTime omits those lines", async () => {
    const client = makeMockClient();
    client.setResponse("/livetv/dvr", DVR_DEVICE);
    client.setResponse(SUBS_PATH, {
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
