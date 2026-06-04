import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerDiscoveryTools } from "../src/tools/discovery.js";
import { makeMockClient, callTool, type RegisterFn } from "./helpers.js";

const register: RegisterFn = registerDiscoveryTools;

describe("search_media", () => {
  it("returns search results", async () => {
    const client = makeMockClient();
    client.setResponse("/search", {
      MediaContainer: {
        Metadata: [
          { ratingKey: "1", title: "Interstellar", type: "movie", year: 2014 },
          { ratingKey: "2", title: "Interstellar Wars", type: "movie", year: 2020 },
        ],
      },
    });
    const { text, isError } = await callTool(
      register,
      "search_media",
      { query: "Interstellar" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /Search results for "Interstellar" \(2\)/);
    assert.match(text, /Interstellar/);
  });

  it("returns message when no results", async () => {
    const client = makeMockClient();
    client.setResponse("/search", { MediaContainer: { Metadata: [] } });
    const { text } = await callTool(register, "search_media", { query: "xyznotfound" }, client);
    assert.match(text, /No results found/);
  });

  it("returns error on API failure", async () => {
    const client = makeMockClient();
    client.setError("/search", 500, "Internal error");
    const { isError } = await callTool(register, "search_media", { query: "test" }, client);
    assert.equal(isError, true);
  });
});

describe("get_genres", () => {
  it("returns genre list for a section", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/genre", {
      MediaContainer: {
        Directory: [{ title: "Action" }, { title: "Comedy" }, { title: "Drama" }],
      },
    });
    const { text, isError } = await callTool(register, "get_genres", { section_id: "1" }, client);
    assert.equal(isError, false);
    assert.match(text, /Genres \(3\)/);
    assert.match(text, /Action/);
    assert.match(text, /Comedy/);
  });

  it("returns message when no genres", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/genre", { MediaContainer: { Directory: [] } });
    const { text } = await callTool(register, "get_genres", { section_id: "1" }, client);
    assert.match(text, /No genres found/);
  });
});

describe("get_actors", () => {
  it("returns actor list", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/actor", {
      MediaContainer: {
        Directory: [{ title: "Tom Hanks" }, { title: "Meryl Streep" }],
      },
    });
    const { text, isError } = await callTool(register, "get_actors", { section_id: "1" }, client);
    assert.equal(isError, false);
    assert.match(text, /Tom Hanks/);
    assert.match(text, /Meryl Streep/);
  });

  it("returns message when no actors", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/actor", { MediaContainer: { Directory: [] } });
    const { text } = await callTool(register, "get_actors", { section_id: "1" }, client);
    assert.match(text, /No actors found/);
  });
});

describe("get_directors", () => {
  it("returns director list", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/director", {
      MediaContainer: {
        Directory: [{ title: "Christopher Nolan" }, { title: "Denis Villeneuve" }],
      },
    });
    const { text, isError } = await callTool(
      register,
      "get_directors",
      { section_id: "1" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /Christopher Nolan/);
    assert.match(text, /Denis Villeneuve/);
  });

  it("returns message when no directors", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/director", { MediaContainer: { Directory: [] } });
    const { text } = await callTool(register, "get_directors", { section_id: "1" }, client);
    assert.match(text, /No directors found/);
  });
});

describe("get_collections", () => {
  it("returns collection list", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/collections", {
      MediaContainer: {
        Metadata: [
          {
            ratingKey: "300",
            title: "Marvel Cinematic Universe",
            type: "collection",
            childCount: 30,
          },
          { ratingKey: "301", title: "Best of the Decade", type: "collection", childCount: 10 },
        ],
      },
    });
    const { text, isError } = await callTool(
      register,
      "get_collections",
      { section_id: "1" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /Collections \(2\)/);
    assert.match(text, /Marvel Cinematic Universe/);
    assert.match(text, /30 items/);
  });

  it("returns message when no collections", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/collections", { MediaContainer: { Metadata: [] } });
    const { text } = await callTool(register, "get_collections", { section_id: "1" }, client);
    assert.match(text, /No collections found/);
  });
});

describe("get_collection_items", () => {
  it("returns items in a collection", async () => {
    const client = makeMockClient();
    client.setResponse("/library/collections/300/children", {
      MediaContainer: {
        title: "MCU",
        Metadata: [
          { ratingKey: "10", title: "Iron Man", type: "movie", year: 2008 },
          { ratingKey: "11", title: "Thor", type: "movie", year: 2011 },
        ],
      },
    });
    const { text, isError } = await callTool(
      register,
      "get_collection_items",
      { collection_id: "300" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /MCU/);
    assert.match(text, /Iron Man/);
  });

  it("returns message when collection is empty", async () => {
    const client = makeMockClient();
    client.setResponse("/library/collections/300/children", {
      MediaContainer: { title: "Empty", Metadata: [] },
    });
    const { text } = await callTool(
      register,
      "get_collection_items",
      { collection_id: "300" },
      client
    );
    assert.match(text, /No items found in collection/);
  });
});

describe("get_related", () => {
  it("returns related content hubs", async () => {
    const client = makeMockClient();
    client.setResponse("/library/metadata/42/related", {
      MediaContainer: {
        Hub: [
          {
            title: "More by Christopher Nolan",
            type: "movie",
            Metadata: [{ ratingKey: "43", title: "Inception", type: "movie", year: 2010 }],
          },
          {
            title: "Similar Sci-Fi",
            type: "movie",
            Metadata: [{ ratingKey: "44", title: "Arrival", type: "movie", year: 2016 }],
          },
        ],
      },
    });
    const { text, isError } = await callTool(register, "get_related", { rating_key: "42" }, client);
    assert.equal(isError, false);
    assert.match(text, /Christopher Nolan/);
    assert.match(text, /Inception/);
    assert.match(text, /Similar Sci-Fi/);
  });

  it("returns message when no related content", async () => {
    const client = makeMockClient();
    client.setResponse("/library/metadata/42/related", { MediaContainer: { Hub: [] } });
    const { text } = await callTool(register, "get_related", { rating_key: "42" }, client);
    assert.match(text, /No related content/);
  });
});

describe("get_recently_added", () => {
  it("returns recently added items across all libraries", async () => {
    const client = makeMockClient();
    client.setResponse("/library/recentlyAdded", {
      MediaContainer: {
        Metadata: [
          { ratingKey: "100", title: "New Movie", type: "movie", year: 2024 },
          { ratingKey: "101", title: "New Show", type: "show", year: 2024 },
        ],
      },
    });
    const { text, isError } = await callTool(register, "get_recently_added", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Recently added \(2\)/);
    assert.match(text, /New Movie/);
  });

  it("scopes to a section when section_id provided", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/2/recentlyAdded", {
      MediaContainer: { Metadata: [{ ratingKey: "200", title: "New Episode", type: "episode" }] },
    });
    const { text } = await callTool(register, "get_recently_added", { section_id: "2" }, client);
    assert.match(text, /New Episode/);
  });

  it("returns message when nothing recently added", async () => {
    const client = makeMockClient();
    client.setResponse("/library/recentlyAdded", { MediaContainer: { Metadata: [] } });
    const { text } = await callTool(register, "get_recently_added", {}, client);
    assert.match(text, /No recently added/);
  });
});

describe("get_on_deck", () => {
  it("returns on-deck items with progress", async () => {
    const client = makeMockClient();
    client.setResponse("/library/onDeck", {
      MediaContainer: {
        Metadata: [
          {
            ratingKey: "50",
            title: "Breaking Bad",
            type: "episode",
            grandparentTitle: "Breaking Bad",
            parentTitle: "Season 2",
            viewOffset: 1200000,
            duration: 2700000,
          },
        ],
      },
    });
    const { text, isError } = await callTool(register, "get_on_deck", {}, client);
    assert.equal(isError, false);
    assert.match(text, /On deck \(1\)/);
    assert.match(text, /44% watched/);
  });

  it("returns message when nothing on deck", async () => {
    const client = makeMockClient();
    client.setResponse("/library/onDeck", { MediaContainer: { Metadata: [] } });
    const { text } = await callTool(register, "get_on_deck", {}, client);
    assert.match(text, /No on-deck/);
  });
});

describe("get_watch_history", () => {
  it("returns watch history with timestamps", async () => {
    const client = makeMockClient();
    client.setResponse("/status/sessions/history/all", {
      MediaContainer: {
        Metadata: [
          { ratingKey: "10", title: "Inception", type: "movie", viewedAt: 1717200000 },
          { ratingKey: "11", title: "Dune", type: "movie", viewedAt: 1717100000 },
        ],
      },
    });
    const { text, isError } = await callTool(register, "get_watch_history", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Watch history \(2\)/);
    assert.match(text, /Inception/);
    assert.match(text, /Dune/);
  });

  it("returns message when no history", async () => {
    const client = makeMockClient();
    client.setResponse("/status/sessions/history/all", { MediaContainer: { Metadata: [] } });
    const { text } = await callTool(register, "get_watch_history", {}, client);
    assert.match(text, /No watch history/);
  });
});

describe("get_random_items", () => {
  it("returns random items from a section", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/all", {
      MediaContainer: {
        Metadata: [
          { ratingKey: "5", title: "Parasite", type: "movie", year: 2019 },
          { ratingKey: "6", title: "Get Out", type: "movie", year: 2017 },
        ],
      },
    });
    const { text, isError } = await callTool(
      register,
      "get_random_items",
      { section_id: "1" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /Random picks \(2\)/);
    assert.match(text, /Parasite/);
  });

  it("returns message when no items match", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/all", { MediaContainer: { Metadata: [] } });
    const { text } = await callTool(
      register,
      "get_random_items",
      { section_id: "1", unwatched: true, genre: "Musical" },
      client
    );
    assert.match(text, /No items found/);
  });

  it("returns error on API failure", async () => {
    const client = makeMockClient();
    client.setError("/library/sections/99/all", 404, "Section not found");
    const { isError } = await callTool(register, "get_random_items", { section_id: "99" }, client);
    assert.equal(isError, true);
  });
});

// Branch coverage: formatting edge cases in discovery tools
describe("discovery formatting edge cases", () => {
  it("get_on_deck: item without viewOffset shows no progress", async () => {
    const client = makeMockClient();
    client.setResponse("/library/onDeck", {
      MediaContainer: {
        Metadata: [{ ratingKey: "10", title: "New Show", type: "episode" }],
      },
    });
    const { text } = await callTool(register, "get_on_deck", {}, client);
    assert.match(text, /New Show/);
    assert.doesNotMatch(text, /%/);
  });

  it("get_on_deck: item with duration > 1 hour exercises hours branch in msToTime", async () => {
    const client = makeMockClient();
    client.setResponse("/library/onDeck", {
      MediaContainer: {
        Metadata: [
          {
            ratingKey: "20",
            title: "Long Film",
            type: "movie",
            viewOffset: 3700000,
            duration: 7200000,
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_on_deck", {}, client);
    assert.match(text, /1h/);
    assert.match(text, /51%/);
  });

  it("get_watch_history: item without viewedAt shows unknown time", async () => {
    const client = makeMockClient();
    client.setResponse("/status/sessions/history/all", {
      MediaContainer: {
        Metadata: [{ ratingKey: "30", title: "Mystery Show", type: "episode" }],
      },
    });
    const { text } = await callTool(register, "get_watch_history", {}, client);
    assert.match(text, /unknown time/);
  });

  it("get_related: hubs with empty Metadata are skipped", async () => {
    const client = makeMockClient();
    client.setResponse("/library/metadata/5/related", {
      MediaContainer: {
        Hub: [
          { title: "Empty Hub", type: "movie", Metadata: [] },
          {
            title: "Populated Hub",
            type: "movie",
            Metadata: [{ ratingKey: "6", title: "A Movie", type: "movie" }],
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_related", { rating_key: "5" }, client);
    assert.doesNotMatch(text, /Empty Hub/);
    assert.match(text, /Populated Hub/);
  });

  it("get_actors: caps display at 200 actors", async () => {
    const client = makeMockClient();
    const manyActors = Array.from({ length: 250 }, (_, i) => ({ title: `Actor ${i}` }));
    client.setResponse("/library/sections/1/actor", {
      MediaContainer: { Directory: manyActors },
    });
    const { text } = await callTool(register, "get_actors", { section_id: "1" }, client);
    assert.match(text, /showing 200 of 250/);
  });
});
