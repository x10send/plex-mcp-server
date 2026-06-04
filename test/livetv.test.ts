import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerLiveTvTools } from "../src/tools/livetv.js";
import { makeMockClient, callTool, type RegisterFn } from "./helpers.js";

const register: RegisterFn = registerLiveTvTools;

const PROVIDERS_WITH_EPG = {
  MediaContainer: {
    MediaProvider: [
      {
        identifier: "tv.plex.provider.epg",
        Feature: [{ key: "/media/providers/tv.plex.provider.epg/items", type: "guide" }],
      },
    ],
  },
};

const PROVIDERS_WITHOUT_EPG = {
  MediaContainer: {
    MediaProvider: [{ identifier: "tv.plex.provider.movies" }],
  },
};

function makeProgram(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ratingKey: "1001",
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
        channelID: "ch-tnt",
        channelKey: "/livetv/channels/ch-tnt",
        startsAt: 1717200000,
        endsAt: 1717207200,
      },
    ],
    ...overrides,
  };
}

function makeEpisode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ratingKey: "2001",
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
        channelKey: "/livetv/channels/ch-amc",
        startsAt: 1717210000,
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
    client.setResponse("/media/providers/tv.plex.provider.epg/items", {
      MediaContainer: { Metadata: [makeProgram()] },
    });
    const { text, isError } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.equal(isError, false);
    assert.match(text, /National Treasure/);
    assert.match(text, /2004/);
    assert.match(text, /TNT/);
    assert.match(text, /PG/);
    assert.match(text, /Adventure/);
    assert.match(text, /Program ID: 1001/);
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
    client.setResponse("/media/providers/tv.plex.provider.epg/items", {
      MediaContainer: { Metadata: [] },
    });
    const { text } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.match(text, /No programs found/);
  });

  it("returns error on unexpected API failure", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setError("/media/providers/tv.plex.provider.epg/items", 500, "Internal error");
    const { isError } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.equal(isError, true);
  });

  it("formats episode with show/season/episode prefix", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setResponse("/media/providers/tv.plex.provider.epg/items", {
      MediaContainer: { Metadata: [makeEpisode()] },
    });
    const { text } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.match(text, /Breaking Bad S1E1: Pilot/);
    assert.match(text, /AMC/);
    assert.match(text, /Program ID: 2001/);
  });

  it("filters by query (title match)", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setResponse("/media/providers/tv.plex.provider.epg/items", {
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
    client.setResponse("/media/providers/tv.plex.provider.epg/items", {
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
    client.setResponse("/media/providers/tv.plex.provider.epg/items", {
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
          startsAt: 1717210000,
          endsAt: 1717217200,
          channelCallSign: "TNT",
          channelKey: "/livetv/channels/ch-tnt",
          channelID: "ch-tnt",
        },
      ],
    });
    const earlier = makeProgram({
      ratingKey: "1",
      title: "Earlier Movie",
      Media: [
        {
          startsAt: 1717200000,
          endsAt: 1717207200,
          channelCallSign: "AMC",
          channelKey: "/livetv/channels/ch-amc",
          channelID: "ch-amc",
        },
      ],
    });
    client.setResponse("/media/providers/tv.plex.provider.epg/items", {
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
    client.setResponse("/media/providers/tv.plex.provider.epg/items", {
      MediaContainer: { Metadata: [makeProgram()] },
    });
    const { text } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.match(text, /National Treasure/);
  });

  it("includes program count and time window in header", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setResponse("/media/providers/tv.plex.provider.epg/items", {
      MediaContainer: { Metadata: [makeProgram(), makeEpisode()] },
    });
    const { text } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.match(text, /2 programs/);
  });

  it("shows rating when present", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setResponse("/media/providers/tv.plex.provider.epg/items", {
      MediaContainer: { Metadata: [makeProgram({ rating: 7.5 })] },
    });
    const { text } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.match(text, /★7\.5/);
  });

  it("handles program with no Media gracefully", async () => {
    const client = makeMockClient();
    client.setResponse("/media/providers", PROVIDERS_WITH_EPG);
    client.setResponse("/media/providers/tv.plex.provider.epg/items", {
      MediaContainer: {
        Metadata: [{ ratingKey: "5", title: "No Schedule", type: "movie" }],
      },
    });
    const { text, isError } = await callTool(register, "get_live_tv_guide", {}, client);
    assert.equal(isError, false);
    assert.match(text, /No Schedule/);
  });
});
