import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerDvrTools } from "../src/tools/dvr.js";
import { makeMockClient, callTool, type RegisterFn } from "./helpers.js";

const register: RegisterFn = registerDvrTools;

const SUBS_PATH = "/media/subscriptions";

// Models the actual nested structure Plex returns for subscriptions.
const SUBSCRIPTION = {
  id: "42",
  type: 2,
  title: "All Episodes",
  hints: {
    title: "National Treasure",
    year: 2004,
    guid: "plex://movie/abc123",
  },
  prefs: {
    oneShot: true,
    startOffsetMinutes: 0,
    endOffsetMinutes: 5,
    onlyNewAirings: 1,
  },
  params: {
    airingChannels: "ch-tnt=TNT",
    airingTimes: "1717200000",
    mediaProviderID: 10,
  },
  status: "scheduled",
};

// ── get_scheduled_recordings ──────────────────────────────────────────────────

describe("get_scheduled_recordings", () => {
  it("returns scheduled recordings list with nested field extraction", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    const { text, isError } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Scheduled Recordings \(1\)/);
    assert.match(text, /\[ID: 42\] National Treasure/);
    assert.match(text, /One-Shot Episodes:/);
    assert.match(text, /TNT/);
    assert.match(text, /Scheduled:/);
    assert.match(text, /Padding: \+5 min/);
    assert.doesNotMatch(text, /Status:/);
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

  it("handles subscription with no optional fields (treated as series)", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [{ id: "1", title: "Bare" }] },
    });
    const { text, isError } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Bare/);
    assert.match(text, /Series Recordings:/);
    assert.doesNotMatch(text, /Channel:/);
    assert.doesNotMatch(text, /Status:/);
  });

  it("shows end-offset padding when present", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [{ id: "5", prefs: { oneShot: true, endOffsetMinutes: 7 } }],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /Padding: \+7 min/);
  });

  it("shows no Scheduled line when airingTimes and startTime are absent", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [{ id: "7", title: "Oddity" }],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.doesNotMatch(text, /Scheduled:/);
  });

  it("shows time range when both airingTimes and endTime are present", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [
          {
            id: "9",
            prefs: { oneShot: true },
            hints: { title: "Movie" },
            params: { airingChannels: "ch-abc=ABC", airingTimes: "1717200000" },
            endTime: 1717207200,
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /Scheduled:.*–/);
  });

  it("groups one-shot subscriptions under One-Shot Episodes and series under Series Recordings", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [
          {
            id: "10",
            hints: { title: "Movie One", guid: "plex://movie/1" },
            prefs: { oneShot: true },
            params: { airingTimes: "1717200000" },
          },
          {
            id: "20",
            hints: { title: "Highlander" },
            prefs: { oneShot: false },
          },
        ],
      },
    });
    const { text, isError } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.equal(isError, false);
    assert.match(text, /One-Shot Episodes:/);
    assert.match(text, /Movie One/);
    assert.match(text, /Series Recordings:/);
    assert.match(text, /Highlander — All Episodes/);
  });

  it("sorts one-shot subscriptions by airingTimes ascending", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [
          {
            id: "2",
            hints: { title: "Later Show" },
            prefs: { oneShot: true },
            params: { airingTimes: "1717300000" },
          },
          {
            id: "1",
            hints: { title: "Earlier Show" },
            prefs: { oneShot: true },
            params: { airingTimes: "1717200000" },
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    const earlierPos = text.indexOf("Earlier Show");
    const laterPos = text.indexOf("Later Show");
    assert.ok(earlierPos < laterPos, "Earlier Show should appear before Later Show");
  });

  it("shows multiple channels with Channels label when airingChannels has comma", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [
          {
            id: "11",
            hints: { title: "Broadcast Show" },
            prefs: { oneShot: false },
            params: { airingChannels: "ch-abc=40.2 MeTV,ch-xyz=10.3 KSAZ" },
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /Channels: 40\.2 MeTV, 10\.3 KSAZ/);
  });

  it("debug=true returns raw subscription JSON", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    const { text, isError } = await callTool(
      register,
      "get_scheduled_recordings",
      { debug: true },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /Total subscriptions: 1/);
    assert.match(text, /First 2 entries/);
    assert.match(text, /National Treasure/);
  });

  it("falls back to key field when id is absent", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [
          { key: "99", hints: { title: "Key-Only Show" }, prefs: { oneShot: true } },
        ],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /\[ID: 99\] Key-Only Show/);
  });

  it("handles PascalCase Hints and Prefs field names", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [
          {
            id: "77",
            Hints: { title: "Pascal Show", guid: "plex://movie/pascal" },
            Prefs: { oneShot: true, endOffsetMinutes: 3 },
            Params: { airingChannels: "ch-abc=ABC", airingTimes: "1717200000" },
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /\[ID: 77\] Pascal Show/);
    assert.match(text, /One-Shot Episodes:/);
    assert.match(text, /Channel: ABC/);
    assert.match(text, /Padding: \+3 min/);
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
    assert.match(text, /Scheduled Recordings \(1\)/);
    assert.match(text, /National Treasure/);
  });
});

// ── get_recording_conflicts ───────────────────────────────────────────────────

describe("get_recording_conflicts", () => {
  it("identifies duplicate subscriptions by GUID", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [
          { id: "1", hints: { title: "Highlander", guid: "plex://episode/abc" } },
          { id: "2", hints: { title: "Highlander", guid: "plex://episode/abc" } },
          { id: "3", hints: { title: "Highlander", guid: "plex://episode/abc" } },
        ],
      },
    });
    const { text, isError } = await callTool(register, "get_recording_conflicts", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Found 1 duplicate group/);
    assert.match(text, /Highlander/);
    assert.match(text, /Duplicates: 3/);
    assert.match(text, /Keep ID: 1/);
    assert.match(text, /Cancel IDs: 2, 3/);
  });

  it("identifies duplicates by title when GUID is absent", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [
          { id: "10", hints: { title: "Mystery Show" } },
          { id: "11", hints: { title: "Mystery Show" } },
        ],
      },
    });
    const { text, isError } = await callTool(register, "get_recording_conflicts", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Mystery Show/);
    assert.match(text, /matched by title/);
    assert.match(text, /Keep ID: 10/);
    assert.match(text, /Cancel IDs: 11/);
  });

  it("returns no-duplicates message when all subscriptions are unique", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [
          { id: "1", hints: { title: "Show A", guid: "plex://episode/a" } },
          { id: "2", hints: { title: "Show B", guid: "plex://episode/b" } },
        ],
      },
    });
    const { text, isError } = await callTool(register, "get_recording_conflicts", {}, client);
    assert.equal(isError, false);
    assert.match(text, /No duplicate recordings found/);
    assert.match(text, /2 subscriptions/);
  });

  it("returns not-configured when /media/subscriptions returns 404", async () => {
    const client = makeMockClient();
    client.setError(SUBS_PATH, 404, "Not found");
    const { text, isError } = await callTool(register, "get_recording_conflicts", {}, client);
    assert.equal(isError, false);
    assert.match(text, /not configured/i);
  });

  it("returns error on API failure (non-404)", async () => {
    const client = makeMockClient();
    client.setError(SUBS_PATH, 503, "Service unavailable");
    const { isError } = await callTool(register, "get_recording_conflicts", {}, client);
    assert.equal(isError, true);
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
    assert.match(text, /Scheduled:/);
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
        MediaSubscription: [{ id: "99", hints: { title: "Show" }, channelTitle: "NBC" }],
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

  it("sends hints[ratingKey], hints[guid], and hints[title] as POST params", async () => {
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
      MediaContainer: { MediaSubscription: [{ hints: { title: "No ID Show" } }] },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /\[ID: \?\]/);
  });

  it("schedule_recording: subscription without airingTimes or startTime omits Scheduled line", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [{ id: "7", title: "Sparse" }],
      },
    });
    const { text } = await callTool(register, "schedule_recording", { program_id: "5" }, client);
    assert.doesNotMatch(text, /Scheduled:/);
    assert.doesNotMatch(text, /Starts:/);
    assert.doesNotMatch(text, /Ends:/);
  });

  it("schedule_recording: falls back to flat channelTitle when params.airingChannels absent", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [{ id: "8", hints: { title: "Flat Show" }, channelTitle: "NBC" }],
      },
    });
    const { text } = await callTool(register, "schedule_recording", { program_id: "5" }, client);
    assert.match(text, /Channel: NBC/);
  });
});
