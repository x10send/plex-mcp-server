import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerLiveTvTools } from "../src/tools/livetv.js";
import { makeMockClient, callTool, type RegisterFn } from "./helpers.js";

const register: RegisterFn = registerLiveTvTools;

// Production Plex cloud EPG uses type "grid" and a path like
// /{identifier}/grid. This is what the real /media/providers returns.
const PROVIDERS_WITH_EPG = {
  MediaContainer: {
    MediaProvider: [
      {
        identifier: "tv.plex.provider.epg",
        Feature: [{ key: "/tv.plex.provider.epg/grid", type: "grid" }],
      },
    ],
  },
};

const PROVIDERS_WITHOUT_EPG = {
  MediaContainer: {
    MediaProvider: [{ identifier: "tv.plex.provider.movies" }],
  },
};

// Guide data endpoint path derived from PROVIDERS_WITH_EPG feature key.
const GUIDE_PATH = "/tv.plex.provider.epg/grid";

function makeProgram(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ratingKey: "1001",
    key: "/library/metadata/1001",
    title: "National Treasure",
    type: "movie",
    year: 2004,
    summary: "A historian races to find the legendary Templar Treasure.",
    contentRating: "PG",
    rating: 6.8,
    Genre: [{ tag: "Adventure" }, { tag: "Action" }],
    Media: [
      {
        channelCallSign: "TNT",
        channelIdentifier: "ch-tnt",
        beginsAt: 1717200000,
        endsAt: 1717207200,
      },
    ],
    ...overrides,
  };
}

function makeEpisode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ratingKey: "2001",
    key: "/library/metadata/2001",
    title: "Pilot",
    type: "episode",
    grandparentTitle: "Breaking Bad",
    parentTitle: "Season 1",
    parentIndex: 1,
    index: 1,
    contentRating: "TV-14",
    Genre: [{ tag: "Drama" }],
    Media: [
      {
        channelCallSign: "AMC",
        channelIdentifier: "ch-amc",
        beginsAt: 1717210000,
        endsAt: 1717213600,
      },
    ],
    ...overrides,
  };
}

describe("get_live_tv_guide", () => {
  it("returns programs in the guide window", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setResponse(GUIDE_PATH, {
      MediaContainer: { Metadata: [makeProgram()] },
    });
    const { text, isError } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.equal(isError, false);
    assert.match(text, /National Treasure/);
    assert.match(text, /2004/);
    assert.match(text, /TNT/);
    assert.match(text, /PG/);
    assert.match(text, /Adventure/);
    assert.match(text, /Program ID: \/library\/metadata\/1001/);
  });

  it("returns not-configured message when no EPG provider", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITHOUT_EPG);
    const { text, isError } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.equal(isError, false);
    assert.match(text, /not configured/i);
  });

  it("returns not-configured message when /media/providers throws", async () => {
    const client = makeMockClient();
    client.setError("/media/providers", 404, "Not found");
    const { text, isError } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.equal(isError, false);
    assert.match(text, /not configured/i);
  });

  it("returns no-results message when guide is empty", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setResponse(GUIDE_PATH, {
      MediaContainer: { Metadata: [] },
    });
    const { text } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.match(text, /No programs found/);
  });

  it("returns error on unexpected API failure", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setError(GUIDE_PATH, 500, "Internal error");
    const { isError } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.equal(isError, true);
  });

  it("returns diagnostic message when guide path returns 404", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setError(GUIDE_PATH, 404, "Not found");
    const { isError, text } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.equal(isError, true);
    assert.match(text, /404/);
    assert.match(text, /tv\.plex\.provider\.epg/);
    assert.match(text, /media\/providers/);
  });

  it("uses provider identifier in fallback path when no Feature key", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", {
      MediaContainer: {
        MediaProvider: [{ identifier: "tv.plex.provider.epg.ota" }],
      },
    });
    client.setResponse("/tv.plex.provider.epg.ota/grid", {
      MediaContainer: { Metadata: [makeProgram()] },
    });
    const { text, isError } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.equal(isError, false);
    assert.match(text, /National Treasure/);
  });

  it("matches feature with type grid", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", {
      MediaContainer: {
        MediaProvider: [
          {
            identifier: "tv.plex.provider.epg",
            Feature: [{ key: "/tv.plex.provider.epg/grid", type: "grid" }],
          },
        ],
      },
    });
    client.setResponse("/tv.plex.provider.epg/grid", {
      MediaContainer: { Metadata: [makeProgram()] },
    });
    const { text, isError } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.equal(isError, false);
    assert.match(text, /National Treasure/);
  });

  it("matches feature with type guide (older Plex installations)", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", {
      MediaContainer: {
        MediaProvider: [
          {
            identifier: "tv.plex.provider.epg",
            Feature: [{ key: "/tv.plex.provider.epg/guide/items", type: "guide" }],
          },
        ],
      },
    });
    client.setResponse("/tv.plex.provider.epg/guide/items", {
      MediaContainer: { Metadata: [makeProgram()] },
    });
    const { text, isError } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.equal(isError, false);
    assert.match(text, /National Treasure/);
  });

  it("formats episode with show/season/episode prefix", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setResponse(GUIDE_PATH, {
      MediaContainer: { Metadata: [makeEpisode()] },
    });
    const { text } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.match(text, /Breaking Bad S1E1: Pilot/);
    assert.match(text, /AMC/);
    assert.match(text, /Program ID: \/library\/metadata\/2001/);
  });

  it("filters by query (title match)", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setResponse(GUIDE_PATH, {
      MediaContainer: {
        Metadata: [makeProgram(), makeProgram({ ratingKey: "1002", title: "Die Hard" })],
      },
    });
    const { text } = await callTool(register, "get_live_tv_guide", { query: "national" }, client);
    assert.match(text, /National Treasure/);
    assert.doesNotMatch(text, /Die Hard/);
    assert.match(text, /1 program/);
  });

  it("filters by query matching grandparentTitle (show name)", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setResponse(GUIDE_PATH, {
      MediaContainer: {
        Metadata: [makeEpisode(), makeProgram()],
      },
    });
    const { text } = await callTool(register, "get_live_tv_guide", { query: "breaking" }, client);
    assert.match(text, /Breaking Bad/);
    assert.doesNotMatch(text, /National Treasure/);
  });

  it("filters by genre", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setResponse(GUIDE_PATH, {
      MediaContainer: {
        Metadata: [
          makeProgram({ Genre: [{ tag: "Adventure" }] }),
          makeProgram({ ratingKey: "9999", title: "News At 10", Genre: [{ tag: "News" }] }),
        ],
      },
    });
    const { text } = await callTool(register, "get_live_tv_guide", { genre: "adventure" }, client);
    assert.match(text, /National Treasure/);
    assert.doesNotMatch(text, /News At 10/);
  });

  it("sorts results by air time", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    const later = makeProgram({
      ratingKey: "2",
      title: "Later Movie",
      Media: [
        {
          beginsAt: 1717210000,
          endsAt: 1717217200,
          channelCallSign: "TNT",
          channelIdentifier: "ch-tnt",
        },
      ],
    });
    const earlier = makeProgram({
      ratingKey: "1",
      title: "Earlier Movie",
      Media: [
        {
          beginsAt: 1717200000,
          endsAt: 1717207200,
          channelCallSign: "AMC",
          channelIdentifier: "ch-amc",
        },
      ],
    });
    client.setResponse(GUIDE_PATH, {
      MediaContainer: { Metadata: [later, earlier] },
    });
    const { text } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.ok(text.indexOf("Earlier Movie") < text.indexOf("Later Movie"));
  });

  it("uses fallback guide path when no Feature key in provider", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", {
      MediaContainer: {
        MediaProvider: [{ identifier: "tv.plex.provider.epg" }],
      },
    });
    client.setResponse("/tv.plex.provider.epg/grid", {
      MediaContainer: { Metadata: [makeProgram()] },
    });
    const { text } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.match(text, /National Treasure/);
  });

  it("includes program count and time window in header", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setResponse(GUIDE_PATH, {
      MediaContainer: { Metadata: [makeProgram(), makeEpisode()] },
    });
    const { text } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.match(text, /2 programs/);
  });

  it("shows rating when present", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setResponse(GUIDE_PATH, {
      MediaContainer: { Metadata: [makeProgram({ rating: 7.5 })] },
    });
    const { text } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.match(text, /★7\.5/);
  });

  it("uses key field as Program ID when present", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setResponse(GUIDE_PATH, {
      MediaContainer: {
        Metadata: [
          { ratingKey: "999", key: "/library/metadata/999", title: "A Movie", type: "movie" },
        ],
      },
    });
    const { text } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.match(text, /Program ID: \/library\/metadata\/999/);
  });

  it("falls back to ratingKey as Program ID when key is absent", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setResponse(GUIDE_PATH, {
      MediaContainer: {
        Metadata: [{ ratingKey: "888", title: "Old Entry", type: "movie" }],
      },
    });
    const { text } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.match(text, /Program ID: 888/);
    assert.doesNotMatch(text, /library\/metadata/);
  });

  it("handles program with no Media gracefully", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setResponse(GUIDE_PATH, {
      MediaContainer: {
        Metadata: [{ ratingKey: "5", title: "No Schedule", type: "movie" }],
      },
    });
    const { text, isError } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.equal(isError, false);
    assert.match(text, /No Schedule/);
  });

  it("tries second provider when first returns 404", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", {
      MediaContainer: {
        MediaProvider: [
          {
            identifier: "tv.plex.provider.epg.1",
            Feature: [{ key: "/tv.plex.provider.epg.1/grid", type: "grid" }],
          },
          {
            identifier: "tv.plex.provider.epg.2",
            Feature: [{ key: "/tv.plex.provider.epg.2/grid", type: "grid" }],
          },
        ],
      },
    });
    client.setError("/tv.plex.provider.epg.1/grid", 404, "Not found");
    client.setResponse("/tv.plex.provider.epg.2/grid", {
      MediaContainer: { Metadata: [makeProgram()] },
    });
    const { text, isError } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.equal(isError, false);
    assert.match(text, /National Treasure/);
  });

  it("tries next provider when first returns empty", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", {
      MediaContainer: {
        MediaProvider: [
          {
            identifier: "tv.plex.provider.epg.1",
            Feature: [{ key: "/tv.plex.provider.epg.1/grid", type: "grid" }],
          },
          {
            identifier: "tv.plex.provider.epg.2",
            Feature: [{ key: "/tv.plex.provider.epg.2/grid", type: "grid" }],
          },
        ],
      },
    });
    client.setResponse("/tv.plex.provider.epg.1/grid", {
      MediaContainer: { Metadata: [] },
    });
    client.setResponse("/tv.plex.provider.epg.2/grid", {
      MediaContainer: { Metadata: [makeProgram()] },
    });
    const { text, isError } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.equal(isError, false);
    assert.match(text, /National Treasure/);
  });

  it("returns diagnostic error when all EPG providers return 404", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", {
      MediaContainer: {
        MediaProvider: [
          {
            identifier: "tv.plex.provider.epg.1",
            Feature: [{ key: "/tv.plex.provider.epg.1/grid", type: "grid" }],
          },
          {
            identifier: "tv.plex.provider.epg.2",
            Feature: [{ key: "/tv.plex.provider.epg.2/grid", type: "grid" }],
          },
        ],
      },
    });
    client.setError("/tv.plex.provider.epg.1/grid", 404, "Not found");
    client.setError("/tv.plex.provider.epg.2/grid", 404, "Not found");
    const { isError, text } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.equal(isError, true);
    assert.match(text, /404/);
    assert.match(text, /tv\.plex\.provider\.epg\.1/);
    assert.match(text, /tv\.plex\.provider\.epg\.2/);
  });
});
