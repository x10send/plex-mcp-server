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
    process.env.DEBUG_MCP = "true";
    try {
      const client = makeMockClient();
      client.setResponse(SUBS_PATH, {
        MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
      });
      const { text, isError } = await callTool(register, "get_scheduled_recordings", {}, client);
      assert.equal(isError, false);
      assert.match(text, /Total subscriptions: 1/);
      assert.match(text, /First 2 entries/);
      assert.match(text, /National Treasure/);
    } finally {
      delete process.env.DEBUG_MCP;
    }
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

  it("extracts title from Directory field (primary GET response structure)", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [
          {
            id: "263",
            type: 2,
            title: "All Episodes",
            airingsType: "New and Repeat Airings",
            Directory: {
              title: "Jeopardy!",
              year: "1984",
              guid: "plex://show/jeop123",
              nextScheduledRecording: "1780712940",
            },
            prefs: { oneShot: false, endOffsetMinutes: 5 },
            params: { airingChannels: "ch-abc=ABC" },
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /\[ID: 263\] Jeopardy! — All Episodes/);
    assert.match(text, /Series Recordings:/);
    assert.match(text, /Next:/);
    assert.match(text, /Filter: New and Repeat Airings/);
    assert.match(text, /Channel: ABC/);
    assert.match(text, /Padding: \+5 min/);
  });

  it("handles Directory as a single-element array", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [
          {
            id: "64",
            type: 2,
            title: "All Episodes",
            airingsType: "New Airings Only",
            Directory: [{ title: "Late Show with Stephen Colbert", year: "2015" }],
            prefs: { oneShot: false },
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /Late Show with Stephen Colbert/);
    assert.match(text, /Filter: New Airings Only/);
  });

  it("handles hints/prefs/params as single-element arrays (Plex array-wrapping variant)", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [
          {
            id: "55",
            type: 2,
            title: "All Episodes",
            hints: [{ title: "Array Show", year: 2020, guid: "plex://show/xyz" }],
            prefs: [{ oneShot: true, endOffsetMinutes: 5 }],
            params: [{ airingChannels: "ch-abc=ABC" }],
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /Array Show/);
    assert.match(text, /One-Shot Episodes:/);
    assert.match(text, /Channel: ABC/);
  });

  it("formats movie subscription with Video.title and year (no All Episodes suffix)", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [
          {
            key: "465",
            type: 1,
            airingsType: "New Airings Only",
            librarySectionTitle: "Movies",
            Video: {
              title: "The Adventures of Robin Hood",
              year: "1938",
              guid: "plex://movie/5fc691381f0c59002e31ce78",
              type: "movie",
            },
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /\[ID: 465\] The Adventures of Robin Hood \(1938\)/);
    assert.doesNotMatch(text, /— All Episodes/);
    assert.doesNotMatch(text, /Unknown/);
    assert.match(text, /Filter: New Airings Only/);
  });

  it("formats series subscription with Directory.title and All Episodes suffix", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [
          {
            key: "307",
            type: 2,
            title: "All Episodes",
            airingsType: "New and Repeat Airings",
            librarySectionTitle: "TV Shows",
            Directory: { title: "Tracker", type: "show", year: "2024" },
            prefs: { oneShot: false },
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /\[ID: 307\] Tracker — All Episodes/);
    assert.doesNotMatch(text, /Unknown/);
  });

  it("formats movie subscription without year when year absent", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [
          {
            key: "466",
            type: 1,
            Video: { title: "Some Movie" },
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /\[ID: 466\] Some Movie/);
    assert.doesNotMatch(text, /\(\)/);
    assert.doesNotMatch(text, /— All Episodes/);
  });

  it("resolves title from grandparentTitle flat field", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [
          {
            id: "465",
            type: 2,
            title: "All Episodes",
            airingsType: "New Airings Only",
            grandparentTitle: "Some Show",
            prefs: { oneShot: false },
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /\[ID: 465\] Some Show — All Episodes/);
    assert.doesNotMatch(text, /Unknown/);
  });

  it("resolves title from Metadata.title nested field", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [
          {
            id: "466",
            type: 2,
            title: "All Episodes",
            Metadata: { title: "Metadata Show" },
            prefs: { oneShot: false },
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /\[ID: 466\] Metadata Show — All Episodes/);
    assert.doesNotMatch(text, /Unknown/);
  });

  it("adds Debug line when title cannot be resolved", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, {
      MediaContainer: {
        MediaSubscription: [
          {
            id: "999",
            type: 2,
            title: "All Episodes",
            prefs: { oneShot: false },
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
    assert.match(text, /\[ID: 999\] Unknown — All Episodes/);
    assert.match(text, /title could not be resolved/);
  });

  it('debug="unknown" returns raw JSON for unresolved subscriptions', async () => {
    process.env.DEBUG_MCP = "true";
    try {
      const client = makeMockClient();
      client.setResponse(SUBS_PATH, {
        MediaContainer: {
          MediaSubscription: [
            { id: "1", Directory: { title: "Known Show" }, prefs: { oneShot: false } },
            { id: "2", type: 2, title: "All Episodes", prefs: { oneShot: false } },
          ],
        },
      });
      const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
      assert.match(text, /Unresolved subscriptions \(1 of 2\)/);
      assert.match(text, /Total subscriptions: 2/);
    } finally {
      delete process.env.DEBUG_MCP;
    }
  });

  it('debug="unknown" reports no unresolved when all titles resolve', async () => {
    process.env.DEBUG_MCP = "true";
    try {
      const client = makeMockClient();
      client.setResponse(SUBS_PATH, {
        MediaContainer: {
          MediaSubscription: [
            { id: "1", Directory: { title: "Show A" }, prefs: { oneShot: false } },
            { id: "2", hints: { title: "Show B" }, prefs: { oneShot: false } },
          ],
        },
      });
      const { text } = await callTool(register, "get_scheduled_recordings", {}, client);
      assert.match(text, /No unresolved subscriptions out of 2/);
      assert.match(text, /Total subscriptions: 2/);
    } finally {
      delete process.env.DEBUG_MCP;
    }
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
      { program_id: "1001", channel_id: "ch-tnt", target_library_section_id: "1" },
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
      { program_id: "1001", target_library_section_id: "1" },
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
        target_library_section_id: "1",
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
      {
        program_id: "1001",
        program_title: "Movie",
        channel_id: "ch-tnt",
        target_library_section_id: "1",
      },
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
      {
        program_id: "bad",
        program_title: "Bad Program",
        channel_id: "ch-tnt",
        target_library_section_id: "1",
      },
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
      {
        program_id: "plex%3A%2F%2Fepisode%2Fabc",
        program_title: "My Show",
        channel_id: "ch-tnt",
        target_library_section_id: "1",
      },
      client
    );
    const params = client.getLastPostParams();
    assert.ok(params != null, "POST must be called");
    assert.equal(params["hints[ratingKey]"], "plex://episode/abc");
    assert.equal(params["hints[guid]"], "plex://episode/abc");
    assert.equal(params["hints[title]"], "My Show");
    assert.equal(params["params[airingChannels]"], undefined);
  });

  it("omits hints[title] when program_title is not provided", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", target_library_section_id: "1" },
      client
    );
    const params = client.getLastPostParams();
    assert.ok(params != null, "POST must be called");
    assert.equal(params["hints[title]"], undefined);
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
        target_library_section_id: "1",
      },
      client
    );
    const params = client.getLastPostParams();
    assert.ok(params != null, "POST must be called");
    assert.equal(params["prefs[startOffsetMinutes]"], "1");
    assert.equal(params["prefs[endOffsetMinutes]"], "2");
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
      { program_id: "1001", program_title: "Movie", target_library_section_id: "1" },
      client
    );
    const params = client.getLastPostParams();
    assert.ok(params != null, "POST must be called");
    assert.equal(params["prefs[startOffsetMinutes]"], "0");
    assert.equal(params["prefs[endOffsetMinutes]"], "5");
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
    assert.ok(params != null, "POST must be called");
    // Template has no `parameters` field → fallback path (post, not postRaw).
    assert.equal(
      client.getLastPostRawBody(),
      undefined,
      "postRaw() must not be called on fallback path"
    );
    assert.equal(params["targetLibrarySectionID"], "6");
    assert.equal(params["params[mediaProviderID]"], "10");
  });

  it("aborts with pre-flight error when targetLibrarySectionID cannot be resolved", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    // No template mock, no target_library_section_id → pre-flight must abort
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    const { text, isError } = await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", program_title: "Movie" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /Pre-flight failed: targetLibrarySectionID missing/);
    assert.equal(
      client.getLastPostParams(),
      undefined,
      "post() must not be called on pre-flight abort"
    );
    assert.equal(
      client.getLastPostRawBody(),
      undefined,
      "postRaw() must not be called on pre-flight abort"
    );
  });

  it("rejects recording when airing_time is more than 30 minutes in the past", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    const staleTime = Math.floor(Date.now() / 1000) - 7200; // 2 hours ago
    const { text, isError } = await callTool(
      register,
      "schedule_recording",
      {
        program_id: "plex%3A%2F%2Fmovie%2Fabc",
        channel_id: "ch-tnt",
        channel_key: "3.1 KTVKDT (Independent)",
        airing_time: staleTime,
        target_library_section_id: "1",
      },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /already passed/);
    assert.equal(
      client.getLastPostParams(),
      undefined,
      "post() must not be called on stale airing"
    );
    assert.equal(
      client.getLastPostRawBody(),
      undefined,
      "postRaw() must not be called on stale airing"
    );
  });

  it("target_library_section_id arg overrides template when provided", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    // Template returns sectionId 6, but explicit arg is 99 — arg wins
    client.setResponse(TEMPLATE_PATH, SUBSCRIPTION_TEMPLATE);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", target_library_section_id: "99" },
      client
    );
    const params = client.getLastPostParams();
    assert.ok(params != null, "POST must be called");
    // Template has no `parameters` field → fallback path (post, not postRaw).
    assert.equal(
      client.getLastPostRawBody(),
      undefined,
      "postRaw() must not be called on fallback path"
    );
    assert.equal(params["targetLibrarySectionID"], "99");
  });

  it("target_library_section_id arg used as fallback when template fails", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    // No template mock → template fails silently
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", target_library_section_id: "3" },
      client
    );
    const params = client.getLastPostParams();
    assert.ok(params != null, "POST must be called");
    assert.equal(params["targetLibrarySectionID"], "3");
  });

  it("infers type=1 for movies from plex://movie/ GUID when program_type omitted", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      { program_id: "plex%3A%2F%2Fmovie%2Fabc123", target_library_section_id: "1" },
      client
    );
    const params = client.getLastPostParams();
    assert.ok(params != null, "POST must be called");
    assert.equal(params["type"], "1");
    assert.equal(params["params[libraryType]"], "1");
    assert.equal(params["prefs[oneShot]"], "true");
  });

  it("sets params[deviceID], params[dvrDeviceID], targetSectionLocationID from /livetv/dvrs", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(TEMPLATE_PATH, SUBSCRIPTION_TEMPLATE);
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
    assert.ok(params != null, "POST must be called");
    // Template has no `parameters` field → fallback path (post, not postRaw).
    assert.equal(
      client.getLastPostRawBody(),
      undefined,
      "postRaw() must not be called on fallback path"
    );
    assert.equal(params["targetSectionLocationID"], "2");
    assert.equal(params["targetLibrarySectionID"], "6"); // from template
    assert.equal(params["params[deviceID]"], "105838FF");
    assert.equal(params["params[dvrDeviceID]"], "1");
  });

  it("omits DVR params when /livetv/dvrs fetch fails", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    // No /livetv/dvrs mock → throws silently
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", target_library_section_id: "1" },
      client
    );
    const params = client.getLastPostParams();
    assert.ok(params != null, "POST must be called");
    assert.equal(params["targetSectionLocationID"], "");
    assert.equal(params["params[deviceID]"], undefined);
    assert.equal(params["params[dvrDeviceID]"], undefined);
  });

  it("debug=true pre-flight check marks missing fields with ✗", async () => {
    process.env.DEBUG_MCP = "true";
    try {
      const client = makeMockClient();
      client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
      // No /livetv/dvrs → deviceID and dvrDeviceID will be missing
      // No channel_id → airingChannels and airingTimes will be missing
      client.setResponse(SUBS_PATH, {
        MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
      });
      const { text } = await callTool(
        register,
        "schedule_recording",
        { program_id: "1001" },
        client
      );
      assert.match(text, /Pre-flight check/);
      assert.match(text, /✗.*params\[deviceID\].*MISSING/);
      assert.match(text, /✗.*params\[airingChannels\].*MISSING/);
    } finally {
      delete process.env.DEBUG_MCP;
    }
  });

  it("debug=true shows POST params in fallback output on success", async () => {
    process.env.DEBUG_MCP = "true";
    try {
      const client = makeMockClient();
      client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
      // No template mock → fallback path shows raw POST params
      client.setResponse(SUBS_PATH, {
        MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
      });
      const { text, isError } = await callTool(
        register,
        "schedule_recording",
        { program_id: "1001", target_library_section_id: "1" },
        client
      );
      assert.equal(isError, false);
      assert.match(text, /DEBUG/);
      assert.match(text, /fallback/);
      assert.match(text, /Recording scheduled/);
    } finally {
      delete process.env.DEBUG_MCP;
    }
  });

  it("debug=true shows endpoint and POST params", async () => {
    process.env.DEBUG_MCP = "true";
    try {
      const client = makeMockClient();
      client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
      client.setResponse(SUBS_PATH, {
        MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
      });
      const { text, isError } = await callTool(
        register,
        "schedule_recording",
        {
          program_id: "plex%3A%2F%2Fmovie%2Fabc",
          program_title: "The Rounders",
          program_type: "movie",
        },
        client
      );
      assert.equal(isError, false);
      assert.match(text, /Endpoint: POST \/media\/subscriptions/);
      assert.match(text, /POST params:/);
      assert.match(text, /type = 1/);
      assert.match(text, /hints\[title\] = The Rounders/);
    } finally {
      delete process.env.DEBUG_MCP;
    }
  });

  it("debug=true shows params and error details on POST failure", async () => {
    process.env.DEBUG_MCP = "true";
    try {
      const client = makeMockClient();
      client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
      client.setError(SUBS_PATH, 400, "Bad Request: invalid program");
      const { text, isError } = await callTool(
        register,
        "schedule_recording",
        { program_id: "1001", target_library_section_id: "1" },
        client
      );
      assert.equal(isError, false);
      assert.match(text, /DEBUG/);
      assert.match(text, /POST failed: HTTP 400/);
      assert.match(text, /Bad Request/);
    } finally {
      delete process.env.DEBUG_MCP;
    }
  });

  it("uses targetLibrarySectionID from template and assembles full params dict", async () => {
    const client = makeMockClient();
    const futureAiringTime = Math.floor(Date.now() / 1000) + 86400; // 1 day from now
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    // parameters lives inside MediaSubscription[0], not as a sibling of it.
    client.setResponse(TEMPLATE_PATH, {
      MediaContainer: {
        SubscriptionTemplate: [
          {
            MediaSubscription: [
              {
                parameters: `hints%5BratingKey%5D=plex%253A%252F%252Fmovie%252Fabc&hints%5Bguid%5D=plex%253A%252F%252Fmovie%252Fabc&params%5BairingChannels%5D=ch-comet%253D3.2&params%5BairingTimes%5D=${futureAiringTime}&params%5BlibraryType%5D=1&params%5BmediaProviderID%5D=10`,
                targetLibrarySectionID: 1,
              },
            ],
          },
        ],
      },
    });
    client.setResponse("/livetv/dvrs", {
      MediaContainer: { Dvr: [{ key: "2", Device: [{ deviceId: "105838FF", key: "1" }] }] },
    });
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      {
        program_id: "plex%3A%2F%2Fmovie%2Fabc",
        program_type: "movie",
        channel_id: "ch-comet",
        channel_key: "3.2 KTVKDT2 (Comet)",
        airing_time: futureAiringTime,
      },
      client
    );
    // Template has `parameters` → postRaw path; verify post() was NOT used.
    assert.equal(
      client.getLastPostParams(),
      undefined,
      "post() must not be called when template provides parameters"
    );
    const rawBody = client.getLastPostRawBody();
    assert.ok(rawBody != null, "postRaw must be called with template body");
    const bodyParams = Object.fromEntries(new URLSearchParams(rawBody!));
    // targetLibrarySectionID comes from template's MediaSubscription[0].targetLibrarySectionID.
    assert.equal(bodyParams["targetLibrarySectionID"], "1");
    assert.ok(bodyParams["hints[ratingKey]"] != null);
    assert.equal(bodyParams["params[airingTimes]"], String(futureAiringTime));
    assert.ok(bodyParams["params[airingChannels]"]?.includes("ch-comet"));
  });

  it("uses channel_key+channel_id override without guide lookup", async () => {
    const client = makeMockClient();
    const futureAiringTime = Math.floor(Date.now() / 1000) + 86400; // 1 day from now
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
        airing_time: futureAiringTime,
        target_library_section_id: "1",
      },
      client
    );
    const params = client.getLastPostParams();
    assert.ok(params != null, "POST must be called");
    assert.equal(params["params[airingChannels]"], "ch-abc123=3.1 KTVKDT (Independent)");
    assert.equal(params["params[airingTimes]"], String(futureAiringTime));
  });

  it("auto-resolves airingChannels and airingTimes via guide lookup when channel_id provided", async () => {
    const client = makeMockClient();
    const futureAiringTime = Math.floor(Date.now() / 1000) + 86400; // 1 day from now
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
                beginsAt: futureAiringTime,
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
      {
        program_id: "plex%3A%2F%2Fepisode%2Fabc",
        channel_id: "ch-tnt",
        target_library_section_id: "1",
      },
      client
    );
    const params = client.getLastPostParams();
    assert.ok(params != null, "POST must be called");
    assert.equal(params["params[airingChannels]"], "ch-tnt=44.1 KPHELD (Independent)");
    assert.equal(params["params[airingTimes]"], String(futureAiringTime));
  });

  it("omits airingChannels and airingTimes when no channel_id and guide lookup not possible", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      { program_id: "1001", target_library_section_id: "1" },
      client
    );
    const params = client.getLastPostParams();
    assert.ok(params != null, "POST must be called");
    assert.equal(params["params[airingChannels]"], undefined);
    assert.equal(params["params[airingTimes]"], undefined);
  });

  it("uses type=1 and oneShot=true for program_type=movie", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      {
        program_id: "5001",
        program_title: "Maverick",
        program_type: "movie",
        target_library_section_id: "1",
      },
      client
    );
    const params = client.getLastPostParams();
    assert.ok(params != null, "POST must be called");
    assert.equal(params["type"], "1");
    assert.equal(params["hints[type]"], "1");
    assert.equal(params["params[libraryType]"], "1");
    assert.equal(params["prefs[oneShot]"], "true");
  });

  it("uses type=2 and oneShot=false for program_type=show", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      {
        program_id: "3001",
        program_title: "Highlander",
        program_type: "show",
        target_library_section_id: "2",
      },
      client
    );
    const params = client.getLastPostParams();
    assert.ok(params != null, "POST must be called");
    assert.equal(params["type"], "2");
    assert.equal(params["hints[type]"], "2");
    assert.equal(params["params[libraryType]"], "2");
    assert.equal(params["prefs[oneShot]"], "false");
  });

  it("uses type=2 and oneShot=true for program_type=episode", async () => {
    const client = makeMockClient();
    client.setResponse(PROVIDERS_PATH, EPG_PROVIDERS);
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [SUBSCRIPTION] },
    });
    await callTool(
      register,
      "schedule_recording",
      {
        program_id: "2001",
        program_title: "Breaking Bad",
        program_type: "episode",
        target_library_section_id: "2",
      },
      client
    );
    const params = client.getLastPostParams();
    assert.ok(params != null, "POST must be called");
    assert.equal(params["type"], "2");
    assert.equal(params["hints[type]"], "2");
    assert.equal(params["params[libraryType]"], "2");
    assert.equal(params["prefs[oneShot]"], "true");
  });
});

// ── update_recording ──────────────────────────────────────────────────────────

const UPDATE_SUB = {
  id: "489",
  type: 2,
  targetLibrarySectionID: 3,
  targetSectionLocationID: "2",
  hints: {
    title: "FIFA World Cup 2026",
    guid: "plex://episode/69ecf90a",
    ratingKey: "plex://episode/69ecf90a",
    type: "2",
  },
  prefs: {
    oneShot: true,
    startOffsetMinutes: 1,
    endOffsetMinutes: 5,
  },
  params: {
    airingChannels: "ch-fox=10.1 KSAZDT (FOX)",
    airingTimes: "1781312400",
    mediaProviderID: 3,
    libraryType: "2",
    deviceID: "105838FF",
    dvrDeviceID: "1",
  },
};

const UPDATED_SUB = {
  id: "490",
  type: 2,
  targetLibrarySectionID: 3,
  hints: { title: "FIFA World Cup 2026", guid: "plex://episode/69ecf90a" },
  prefs: { oneShot: true, startOffsetMinutes: 1, endOffsetMinutes: 60 },
  params: { airingChannels: "ch-fox=10.1 KSAZDT (FOX)", airingTimes: "1781312400" },
};

describe("update_recording", () => {
  it("creates new subscription with updated padding, then deletes the old one", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, { MediaContainer: { MediaSubscription: [UPDATE_SUB] } });
    client.setPostResponse(SUBS_PATH, { MediaContainer: { MediaSubscription: [UPDATED_SUB] } });
    client.setResponse(`${SUBS_PATH}/489`, { MediaContainer: {} });
    const { text, isError } = await callTool(
      register,
      "update_recording",
      { subscription_id: "489", end_offset_seconds: 3600 },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /Recording updated/);
    assert.match(text, /New Subscription ID: 490/);
    assert.match(text, /Old subscription 489 cancelled/);
    assert.match(text, /end \+60 min/);
    assert.equal(client.getLastDeletePath(), `${SUBS_PATH}/489`);
    const postParams = client.getLastPostParams();
    assert.ok(postParams != null, "POST must be called");
    assert.equal(postParams["prefs[endOffsetMinutes]"], "60");
    assert.equal(postParams["prefs[startOffsetMinutes]"], "1"); // preserved from stored prefs
    assert.equal(postParams["hints[guid]"], "plex://episode/69ecf90a");
    assert.equal(postParams["targetLibrarySectionID"], "3");
    assert.equal(postParams["params[airingChannels]"], "ch-fox=10.1 KSAZDT (FOX)");
  });

  it("preserves existing start and end offsets when neither arg is provided", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, { MediaContainer: { MediaSubscription: [UPDATE_SUB] } });
    client.setPostResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [UPDATED_SUB] },
    });
    client.setResponse(`${SUBS_PATH}/489`, { MediaContainer: {} });
    await callTool(register, "update_recording", { subscription_id: "489" }, client);
    const postParams = client.getLastPostParams();
    assert.ok(postParams != null, "POST must be called");
    assert.equal(postParams["prefs[startOffsetMinutes]"], "1"); // from UPDATE_SUB.prefs
    assert.equal(postParams["prefs[endOffsetMinutes]"], "5"); // from UPDATE_SUB.prefs
  });

  it("returns not-found message when subscription_id is not in list", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, { MediaContainer: { MediaSubscription: [] } });
    const { text, isError } = await callTool(
      register,
      "update_recording",
      { subscription_id: "999" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /not found/i);
    assert.equal(
      client.getLastPostParams(),
      undefined,
      "post() must not be called when subscription not found"
    );
    assert.equal(
      client.getLastPostRawBody(),
      undefined,
      "postRaw() must not be called when subscription not found"
    );
  });

  it("returns error and leaves original subscription when POST fails", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, { MediaContainer: { MediaSubscription: [UPDATE_SUB] } });
    client.setPostError(SUBS_PATH, 400, "Bad Request");
    const { isError } = await callTool(
      register,
      "update_recording",
      { subscription_id: "489", end_offset_seconds: 3600 },
      client
    );
    assert.equal(isError, true); // falls through to toolError
    assert.equal(
      client.getLastDeletePath(),
      undefined,
      "DELETE must not be called when POST fails"
    );
  });

  it("returns warning but succeeds when DELETE fails after successful POST", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, { MediaContainer: { MediaSubscription: [UPDATE_SUB] } });
    client.setPostResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [UPDATED_SUB] },
    });
    client.setError(`${SUBS_PATH}/489`, 404, "Not found");
    const { text, isError } = await callTool(
      register,
      "update_recording",
      { subscription_id: "489", end_offset_seconds: 3600 },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /Recording updated/);
    assert.match(text, /Warning.*cancel original subscription 489/i);
    assert.match(text, /cancel_recording/);
  });

  it("uses stored deviceID and dvrDeviceID from subscription params", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, { MediaContainer: { MediaSubscription: [UPDATE_SUB] } });
    client.setPostResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [UPDATED_SUB] },
    });
    client.setResponse(`${SUBS_PATH}/489`, { MediaContainer: {} });
    await callTool(register, "update_recording", { subscription_id: "489" }, client);
    const postParams = client.getLastPostParams();
    assert.ok(postParams != null, "POST must be called");
    assert.equal(postParams["params[deviceID]"], "105838FF");
    assert.equal(postParams["params[dvrDeviceID]"], "1");
  });

  it("re-fetches device info from /livetv/dvrs when subscription params lack deviceID", async () => {
    const client = makeMockClient();
    const subNoDevice = {
      ...UPDATE_SUB,
      params: { airingChannels: "ch-fox=FOX", mediaProviderID: 3, libraryType: "2" },
    };
    client.setResponse(SUBS_PATH, { MediaContainer: { MediaSubscription: [subNoDevice] } });
    client.setPostResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [UPDATED_SUB] },
    });
    client.setResponse("/livetv/dvrs", {
      MediaContainer: { Dvr: [{ key: "2", Device: [{ deviceId: "AABBCC", key: "7" }] }] },
    });
    client.setResponse(`${SUBS_PATH}/489`, { MediaContainer: {} });
    await callTool(register, "update_recording", { subscription_id: "489" }, client);
    const postParams = client.getLastPostParams();
    assert.ok(postParams != null, "POST must be called");
    assert.equal(postParams["params[deviceID]"], "AABBCC");
    assert.equal(postParams["params[dvrDeviceID]"], "7");
  });

  it("target_library_section_id arg overrides stored targetLibrarySectionID", async () => {
    const client = makeMockClient();
    client.setResponse(SUBS_PATH, { MediaContainer: { MediaSubscription: [UPDATE_SUB] } });
    client.setPostResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [UPDATED_SUB] },
    });
    client.setResponse(`${SUBS_PATH}/489`, { MediaContainer: {} });
    await callTool(
      register,
      "update_recording",
      { subscription_id: "489", target_library_section_id: "99" },
      client
    );
    const postParams = client.getLastPostParams();
    assert.ok(postParams != null, "POST must be called");
    assert.equal(postParams["targetLibrarySectionID"], "99");
  });

  it("returns not-configured when GET /media/subscriptions returns 404", async () => {
    const client = makeMockClient();
    client.setError(SUBS_PATH, 404, "Not found");
    const { text, isError } = await callTool(
      register,
      "update_recording",
      { subscription_id: "489" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /not configured/i);
  });

  it("debug=true shows extracted params and POST details", async () => {
    process.env.DEBUG_MCP = "true";
    try {
      const client = makeMockClient();
      client.setResponse(SUBS_PATH, { MediaContainer: { MediaSubscription: [UPDATE_SUB] } });
      client.setPostResponse(SUBS_PATH, {
        MediaContainer: { MediaSubscription: [UPDATED_SUB] },
      });
      client.setResponse(`${SUBS_PATH}/489`, { MediaContainer: {} });
      const { text, isError } = await callTool(
        register,
        "update_recording",
        { subscription_id: "489", end_offset_seconds: 1800 },
        client
      );
      assert.equal(isError, false);
      assert.match(text, /DEBUG/);
      assert.match(text, /guid: plex:\/\/episode\/69ecf90a/);
      assert.match(text, /POST params:/);
      assert.match(text, /Recording updated/);
    } finally {
      delete process.env.DEBUG_MCP;
    }
  });

  it("debug=true shows POST failure details on error", async () => {
    process.env.DEBUG_MCP = "true";
    try {
      const client = makeMockClient();
      client.setResponse(SUBS_PATH, { MediaContainer: { MediaSubscription: [UPDATE_SUB] } });
      client.setPostError(SUBS_PATH, 400, "Bad Request: stale airing");
      const { text, isError } = await callTool(
        register,
        "update_recording",
        { subscription_id: "489" },
        client
      );
      assert.equal(isError, false); // debug mode returns structured error, not isError
      assert.match(text, /POST failed: HTTP 400/);
      assert.match(text, /original subscription 489 is unchanged/i);
    } finally {
      delete process.env.DEBUG_MCP;
    }
  });
});

// ── cancel_recording ──────────────────────────────────────────────────────────

describe("cancel_recording", () => {
  it("cancels a recording and shows Verified when subscription is gone", async () => {
    const client = makeMockClient();
    client.setResponse(`${SUBS_PATH}/42`, { MediaContainer: {} });
    client.setResponse(SUBS_PATH, { MediaContainer: { MediaSubscription: [] } });
    const { text, isError } = await callTool(
      register,
      "cancel_recording",
      { subscription_id: "42" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /42/);
    assert.match(text, /cancelled/);
    assert.match(text, /Verified: removed/);
  });

  it("shows title when Plex echoes back the deleted subscription", async () => {
    const client = makeMockClient();
    client.setResponse(`${SUBS_PATH}/42`, {
      MediaContainer: {
        MediaSubscription: [{ id: "42", Directory: { title: "Tracker" } }],
      },
    });
    client.setResponse(SUBS_PATH, { MediaContainer: { MediaSubscription: [] } });
    const { text } = await callTool(
      register,
      "cancel_recording",
      { subscription_id: "42" },
      client
    );
    assert.match(text, /Title: Tracker/);
    assert.match(text, /Verified: removed/);
  });

  it("shows Warning when subscription still appears after cancel", async () => {
    const client = makeMockClient();
    client.setResponse(`${SUBS_PATH}/42`, { MediaContainer: {} });
    client.setResponse(SUBS_PATH, {
      MediaContainer: { MediaSubscription: [{ id: "42" }] },
    });
    const { text, isError } = await callTool(
      register,
      "cancel_recording",
      { subscription_id: "42" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /cancelled/);
    assert.match(text, /Warning.*still appears/);
  });

  it("omits Verified line when verification GET fails", async () => {
    const client = makeMockClient();
    client.setResponse(`${SUBS_PATH}/42`, { MediaContainer: {} });
    // No mock for SUBS_PATH → verification throws, caught silently
    const { text, isError } = await callTool(
      register,
      "cancel_recording",
      { subscription_id: "42" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /cancelled/);
    assert.doesNotMatch(text, /Verified/);
    assert.doesNotMatch(text, /Warning/);
  });

  it("debug=true includes endpoint, response, and verification details", async () => {
    process.env.DEBUG_MCP = "true";
    try {
      const client = makeMockClient();
      client.setResponse(`${SUBS_PATH}/42`, { MediaContainer: {} });
      client.setResponse(SUBS_PATH, { MediaContainer: { MediaSubscription: [] } });
      const { text, isError } = await callTool(
        register,
        "cancel_recording",
        { subscription_id: "42" },
        client
      );
      assert.equal(isError, false);
      assert.match(text, /DEBUG/);
      assert.match(text, /DELETE.*\/media\/subscriptions\/42/);
      assert.match(text, /Verification GET/);
      assert.match(text, /cancelled/);
    } finally {
      delete process.env.DEBUG_MCP;
    }
  });

  it("debug=true returns structured error details on DELETE failure", async () => {
    process.env.DEBUG_MCP = "true";
    try {
      const client = makeMockClient();
      client.setError(`${SUBS_PATH}/42`, 404, "Not found");
      const { text, isError } = await callTool(
        register,
        "cancel_recording",
        { subscription_id: "42" },
        client
      );
      assert.equal(isError, false);
      assert.match(text, /DEBUG/);
      assert.match(text, /HTTP 404/);
    } finally {
      delete process.env.DEBUG_MCP;
    }
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

  it("returns error on API failure (non-debug, e.g. subscription not found)", async () => {
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
    const { text } = await callTool(
      register,
      "schedule_recording",
      { program_id: "5", target_library_section_id: "1" },
      client
    );
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
    const { text } = await callTool(
      register,
      "schedule_recording",
      { program_id: "5", target_library_section_id: "1" },
      client
    );
    assert.match(text, /Channel: NBC/);
  });
});
