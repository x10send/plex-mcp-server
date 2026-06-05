import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerDvrTools } from "../src/tools/dvr.js";
import { makeMockClient, callTool, type RegisterFn } from "./helpers.js";

const register: RegisterFn = registerDvrTools;

// All DVR tools hit /media/subscriptions directly — no device discovery step.
const SUBS_PATH = "/media/subscriptions";

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
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [] },
    });
    const { text, isError } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.equal(isError, false);
    assert.match(text, /No scheduled recordings/);
  });

  it("handles subscription with no optional fields", async () => {
    const client = makeMockClient();
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
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [{ id: "7", title: "Oddity", endTime: 1717207200 }],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.doesNotMatch(text, /→/);
    assert.doesNotMatch(text, /Starts:/);
  });

  it("returns not-configured message when /media/subscriptions returns 404", async () => {
    const client = makeMockClient();
    client.setError(SUBS_PATH, 404, "Not found");
    const { text, isError } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.equal(isError, false);
    assert.match(text, /not configured/i);
  });

  it("returns error on API failure (non-404)", async () => {
    const client = makeMockClient();
    client.setError(SUBS_PATH, 503, "DVR unavailable");
    const { isError } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.equal(isError, true);
  });

  it("handles single-object MediaSubscription (Plex single-item response)", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: SUBSCRIPTION },
    });
    const { text, isError } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Scheduled recordings \(1\)/);
    assert.match(text, /National Treasure/);
  });
});

// ── schedule_recording ────────────────────────────────────────────────────────

describe("schedule_recording", () => {
  it("schedules a recording and returns subscription details", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    const { text, isError } = await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", channel_id: "ch-tnt" },
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
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [] },
    });
    const { text, isError } = await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", channel_id: "ch-tnt" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /no subscription details/);
  });

  it("accepts optional start and end offset parameters", async () => {
    const client = makeMockClient();
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
        channel_id: "ch-nbc",
        start_offset_seconds: 30,
        end_offset_seconds: 120,
      },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /Subscription ID: 99/);
  });

  it("returns not-configured message when /media/subscriptions returns 404", async () => {
    const client = makeMockClient();
    client.setError(SUBS_PATH, 404, "Not found");
    const { text, isError } = await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", channel_id: "ch-tnt" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /not configured/i);
  });

  it("returns error on API failure (non-404)", async () => {
    const client = makeMockClient();
    client.setError(SUBS_PATH, 422, "Invalid program");
    const { isError, text } = await callTool(
      register,
      "schedule_recording",
      { program_id: "bad", channel_id: "ch-tnt" },
      client
    );
    assert.equal(isError, true);
    assert.match(text, /422/);
  });

  it("sends programKey and channelKey as POST params", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      { program_id: "plex%3A%2F%2Fepisode%2Fabc", channel_id: "ch-tnt" },
      client
    );
    const params = client.getLastPostParams();
    assert.equal(params?.programKey, "plex%3A%2F%2Fepisode%2Fabc");
    assert.equal(params?.channelKey, "ch-tnt");
  });

  it("sends negative startTimeOffset for pre-roll seconds", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      {
        program_id: "plex%3A%2F%2Fepisode%2Fabc",
        channel_id: "ch-tnt",
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

// ── dvr formatting edge cases ─────────────────────────────────────────────────

describe("dvr formatting edge cases", () => {
  it("formatSubscription: missing id shows ? placeholder", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [{ title: "No ID Show" }] },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /\[\?\]/);
  });

  it("schedule_recording: subscription missing startTime/endTime omits those lines", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [{ id: "7", title: "Sparse" }],
      },
    });
    const { text } = await callTool(
      register,
      "schedule_recording",
      { program_id: "5", channel_id: "ch-x" },
      client
    );
    assert.doesNotMatch(text, /Starts:/);
    assert.doesNotMatch(text, /Ends:/);
  });
});
