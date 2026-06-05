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

const PROVIDERS_PATH = "/media/providers";
const TEMPLATE_PATH = "/media/subscriptions/template";

const EPG_PROVIDERS = {
  MediaContainer: {
    MediaProvider: [{ identifier: "tv.plex.providers.epg.cloud", id: 10 }],
  },
};

const SUBSCRIPTION_TEMPLATE = {
  MediaContainer: {
    SubscriptionTemplate: [{ MediaSubscription: [{ targetLibrarySectionID: 6 }] }],
  },
};

describe("schedule_recording", () => {
  it("schedules a recording and returns subscription details", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(TEMPLATE_PATH, SUBSCRIPTION_TEMPLATE);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    const { text, isError } = await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", program_title: "National Treasure", channel_id: "ch-tnt" },
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

  it("schedules a recording without program_title (title is optional)", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
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
  });

  it("handles response with no subscription object", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [] },
    });
    const { text, isError } = await callTool(
      register,
      "schedule_recording",
      { program_id: "1001" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /no subscription details/);
  });

  it("accepts optional start and end offset parameters", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
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
        program_title: "Show",
        channel_id: "ch-nbc",
        start_offset_seconds: 30,
        end_offset_seconds: 120,
      },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /Subscription ID: 99/);
  });

  it("returns not-configured message when /media/providers returns 404", async () => {
    const client = makeMockClient();
    client.setError(PROVIDERS_PATH, 404, "Not found");
    const { text, isError } = await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", program_title: "Movie" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /not configured/i);
  });

  it("returns not-configured message when no EPG provider in providers response", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, { MediaContainer: { MediaProvider: [] } });
    const { text, isError } = await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", program_title: "Movie" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /not configured/i);
  });

  it("returns not-configured message when /media/subscriptions POST returns 404", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setError(SUBS_PATH, 404, "Not found");
    const { text, isError } = await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", program_title: "Movie", channel_id: "ch-tnt" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /not configured/i);
  });

  it("returns error on API failure (non-404)", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setError(SUBS_PATH, 422, "Invalid program");
    const { isError, text } = await callTool(
      register,
      "schedule_recording",
      { program_id: "bad", program_title: "Bad Program", channel_id: "ch-tnt" },
      client
    );
    assert.equal(isError, true);
    assert.match(text, /422/);
  });

  it("sends hints[ratingKey], hints[guid], and params[airingChannels] as POST params", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      { program_id: "plex%3A%2F%2Fepisode%2Fabc", program_title: "My Show", channel_id: "ch-tnt" },
      client
    );
    const params = client.getLastPostParams();
    assert.equal(params?.["hints[ratingKey]"], "plex://episode/abc");
    assert.equal(params?.["hints[guid]"], "plex://episode/abc");
    assert.equal(params?.["hints[title]"], "My Show");
    assert.equal(params?.["params[airingChannels]"], undefined);
  });

  it("omits hints[title] when program_title is not provided", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(register, "schedule_recording", { program_id: "1001" }, client);
    const params = client.getLastPostParams();
    assert.equal(params?.["hints[title]"], undefined);
  });

  it("converts offset seconds to minutes (ceiling) in POST params", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      {
        program_id: "plex%3A%2F%2Fepisode%2Fabc",
        program_title: "My Show",
        channel_id: "ch-tnt",
        start_offset_seconds: 30,
        end_offset_seconds: 120,
      },
      client
    );
    const params = client.getLastPostParams();
    assert.equal(params?.["prefs[startOffsetMinutes]"], "1");
    assert.equal(params?.["prefs[endOffsetMinutes]"], "2");
  });

  it("defaults end offset to 5 minutes when not specified", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", program_title: "Movie" },
      client
    );
    const params = client.getLastPostParams();
    assert.equal(params?.["prefs[startOffsetMinutes]"], "0");
    assert.equal(params?.["prefs[endOffsetMinutes]"], "5");
  });

  it("includes targetLibrarySectionID from template when available", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(TEMPLATE_PATH, SUBSCRIPTION_TEMPLATE);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", program_title: "Movie" },
      client
    );
    const params = client.getLastPostParams();
    assert.equal(params?.["targetLibrarySectionID"], "6");
    assert.equal(params?.["params[mediaProviderID]"], "10");
  });

  it("omits targetLibrarySectionID when template fetch fails", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    // No template mock → mock throws "no response configured" → caught silently
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", program_title: "Movie" },
      client
    );
    const params = client.getLastPostParams();
    assert.equal(params?.["targetLibrarySectionID"], undefined);
  });

  it("sets params[deviceID], params[dvrDeviceID], targetSectionLocationID from /livetv/dvrs", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse("/livetv/dvrs", {
      MediaContainer: {
        Dvr: [{ key: "2", Device: [{ deviceId: "105838FF", key: "1" }] }],
      },
    });
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(register, "schedule_recording", { program_id: "1001" }, client);
    const params = client.getLastPostParams();
    assert.equal(params?.["targetSectionLocationID"], "");
    assert.equal(params?.["targetLibrarySectionID"], "2");
    assert.equal(params?.["params[deviceID]"], "105838FF");
    assert.equal(params?.["params[dvrDeviceID]"], "1");
  });

  it("omits DVR params when /livetv/dvrs fetch fails", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    // No /livetv/dvrs mock → throws silently
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(register, "schedule_recording", { program_id: "1001" }, client);
    const params = client.getLastPostParams();
    assert.equal(params?.["targetSectionLocationID"], "");
    assert.equal(params?.["params[deviceID]"], undefined);
    assert.equal(params?.["params[dvrDeviceID]"], undefined);
  });

  it("debug=true shows POST params in output on success", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    const { text, isError } = await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", debug: true },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /DEBUG/);
    assert.match(text, /hints\[ratingKey\]/);
    assert.match(text, /Recording scheduled/);
  });

  it("debug=true shows params and error details on POST failure", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setError(SUBS_PATH, 400, "Bad Request: invalid program");
    const { text, isError } = await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", debug: true },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /DEBUG/);
    assert.match(text, /POST failed: HTTP 400/);
    assert.match(text, /Bad Request/);
    assert.match(text, /hints\[ratingKey\]/);
  });

  it("uses channel_key+channel_id override without guide lookup", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      {
        program_id: "1001",
        channel_id: "ch-abc123",
        channel_key: "3.1 KTVKDT (Independent)",
        airing_time: 1780905600,
      },
      client
    );
    const params = client.getLastPostParams();
    assert.equal(params?.["params[airingChannels]"], "ch-abc123=3.1 KTVKDT (Independent)");
    assert.equal(params?.["params[airingTimes]"], "1780905600");
  });

  it("auto-resolves airingChannels and airingTimes via guide lookup when channel_id provided", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse("/tv.plex.providers.epg.cloud/grid", {
      MediaContainer: {
        Metadata: [
          {
            ratingKey: "plex://episode/abc",
            Media: [
              {
                channelIdentifier: "ch-tnt",
                channelTitle: "44.1 KPHELD (Independent)",
                beginsAt: 1717200000,
              },
            ],
          },
        ],
      },
    });
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
    assert.equal(params?.["params[airingChannels]"], "ch-tnt=44.1 KPHELD (Independent)");
    assert.equal(params?.["params[airingTimes]"], "1717200000");
  });

  it("omits airingChannels and airingTimes when no channel_id and guide lookup not possible", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(register, "schedule_recording", { program_id: "1001" }, client);
    const params = client.getLastPostParams();
    assert.equal(params?.["params[airingChannels]"], undefined);
    assert.equal(params?.["params[airingTimes]"], undefined);
  });

  it("uses show content type (2) and oneShot=false for program_type=show", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      { program_id: "3001", program_title: "Highlander", program_type: "show" },
      client
    );
    const params = client.getLastPostParams();
    assert.equal(params?.["type"], "2");
    assert.equal(params?.["hints[type]"], "2");
    assert.equal(params?.["params[libraryType]"], "2");
    assert.equal(params?.["prefs[oneShot]"], "false");
  });

  it("uses type=2 for program_type=episode — matches confirmed-working HAR", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      { program_id: "2001", program_title: "Breaking Bad", program_type: "episode" },
      client
    );
    const params = client.getLastPostParams();
    assert.equal(params?.["type"], "2");
    assert.equal(params?.["hints[type]"], "2");
    assert.equal(params?.["params[libraryType]"], "2");
    assert.equal(params?.["prefs[oneShot]"], "true");
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
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [{ id: "7", title: "Sparse" }],
      },
    });
    const { text } = await callTool(register, "schedule_recording", { program_id: "5" }, client);
    assert.doesNotMatch(text, /Starts:/);
    assert.doesNotMatch(text, /Ends:/);
  });
});
