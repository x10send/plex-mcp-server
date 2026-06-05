import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerLibraryTools } from "../src/tools/library.js";
import { makeMockClient, callTool, type RegisterFn } from "./helpers.js";

const register: RegisterFn = registerLibraryTools;

describe("get_libraries", () => {
  it("returns formatted library list", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections", {
      MediaContainer: {
        Directory: [
          { key: "1", title: "Movies", type: "movie", count: 342 },
          { key: "2", title: "TV Shows", type: "show", count: 87 },
        ],
      },
    });
    const { text, isError } = await callTool(register, "get_libraries", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Libraries \(2\)/);
    assert.match(text, /\[1\] Movies/);
    assert.match(text, /\[2\] TV Shows/);
  });

  it("returns message when no libraries", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections", { MediaContainer: { Directory: [] } });
    const { text } = await callTool(register, "get_libraries", {}, client);
    assert.match(text, /No libraries found/);
  });

  it("returns error on Plex API failure", async () => {
    const client = makeMockClient();
    client.setError("/library/sections", 401, "Unauthorized");
    const { text, isError } = await callTool(register, "get_libraries", {}, client);
    assert.equal(isError, true);
    assert.match(text, /401/);
  });
});

describe("get_library_contents", () => {
  it("returns paginated items with total", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/all", {
      MediaContainer: {
        totalSize: 100,
        Metadata: [
          { ratingKey: "10", title: "Inception", type: "movie", year: 2010 },
          { ratingKey: "11", title: "The Dark Knight", type: "movie", year: 2008 },
        ],
      },
    });
    const { text, isError } = await callTool(
      register,
      "get_library_contents",
      { section_id: "1" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /0–2 of 100/);
    assert.match(text, /Inception/);
    assert.match(text, /Dark Knight/);
  });

  it("returns message when no items match", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/all", { MediaContainer: { Metadata: [] } });
    const { text } = await callTool(register, "get_library_contents", { section_id: "1" }, client);
    assert.match(text, /No items found/);
  });

  it("returns error on API failure", async () => {
    const client = makeMockClient();
    client.setError("/library/sections/1/all", 404, "Section not found");
    const { isError } = await callTool(
      register,
      "get_library_contents",
      { section_id: "1" },
      client
    );
    assert.equal(isError, true);
  });

  it("shows quality fields inline when Media is present", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/all", {
      MediaContainer: {
        totalSize: 1,
        Metadata: [
          {
            ratingKey: "20",
            title: "Dune",
            type: "movie",
            year: 2021,
            Media: [
              {
                videoResolution: "4k",
                bitrate: 25000,
                videoCodec: "hevc",
                audioCodec: "truehd",
                audioChannels: 8,
                Part: [{ size: 55834574848 }],
              },
            ],
          },
        ],
      },
    });
    const { text, isError } = await callTool(
      register,
      "get_library_contents",
      { section_id: "1" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /Dune/);
    assert.match(text, /4K/);
    assert.match(text, /25\.0 Mbps/);
    assert.match(text, /HEVC/);
    assert.match(text, /TrueHD 7\.1/);
    assert.match(text, /52\.00 GB/);
  });

  it("omits quality fields when item has no Media", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/all", {
      MediaContainer: {
        totalSize: 1,
        Metadata: [{ ratingKey: "21", title: "No Media Movie", type: "movie" }],
      },
    });
    const { text } = await callTool(register, "get_library_contents", { section_id: "1" }, client);
    assert.match(text, /No Media Movie \[movie\]/);
    assert.doesNotMatch(text, /\|/);
  });

  it("filters by resolution=1080p", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/all", {
      MediaContainer: {
        totalSize: 3,
        Metadata: [
          {
            ratingKey: "30",
            title: "HD Movie",
            type: "movie",
            Media: [{ videoResolution: "1080", bitrate: 8000 }],
          },
          {
            ratingKey: "31",
            title: "4K Movie",
            type: "movie",
            Media: [{ videoResolution: "4k", bitrate: 25000 }],
          },
          {
            ratingKey: "32",
            title: "SD Movie",
            type: "movie",
            Media: [{ videoResolution: "sd", bitrate: 1500 }],
          },
        ],
      },
    });
    const { text, isError } = await callTool(
      register,
      "get_library_contents",
      { section_id: "1", resolution: "1080p" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /HD Movie/);
    assert.doesNotMatch(text, /4K Movie/);
    assert.doesNotMatch(text, /SD Movie/);
  });

  it("filters by resolution=4k", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/all", {
      MediaContainer: {
        totalSize: 2,
        Metadata: [
          {
            ratingKey: "33",
            title: "4K Film",
            type: "movie",
            Media: [{ videoResolution: "4k", bitrate: 30000 }],
          },
          {
            ratingKey: "34",
            title: "1080 Film",
            type: "movie",
            Media: [{ videoResolution: "1080", bitrate: 8000 }],
          },
        ],
      },
    });
    const { text } = await callTool(
      register,
      "get_library_contents",
      { section_id: "1", resolution: "4k" },
      client
    );
    assert.match(text, /4K Film/);
    assert.doesNotMatch(text, /1080 Film/);
  });

  it("filters by resolution=sd (matches sd and 480)", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/all", {
      MediaContainer: {
        totalSize: 3,
        Metadata: [
          {
            ratingKey: "35",
            title: "Old TV",
            type: "episode",
            Media: [{ videoResolution: "sd", bitrate: 800 }],
          },
          {
            ratingKey: "36",
            title: "DVD Rip",
            type: "movie",
            Media: [{ videoResolution: "480", bitrate: 1200 }],
          },
          {
            ratingKey: "37",
            title: "HD Show",
            type: "episode",
            Media: [{ videoResolution: "720", bitrate: 4000 }],
          },
        ],
      },
    });
    const { text } = await callTool(
      register,
      "get_library_contents",
      { section_id: "1", resolution: "sd" },
      client
    );
    assert.match(text, /Old TV/);
    assert.match(text, /DVD Rip/);
    assert.doesNotMatch(text, /HD Show/);
  });

  it("filters by min_bitrate", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/all", {
      MediaContainer: {
        totalSize: 3,
        Metadata: [
          {
            ratingKey: "40",
            title: "High Bitrate",
            type: "movie",
            Media: [{ videoResolution: "1080", bitrate: 15000 }],
          },
          {
            ratingKey: "41",
            title: "Low Bitrate",
            type: "movie",
            Media: [{ videoResolution: "1080", bitrate: 3000 }],
          },
          {
            ratingKey: "42",
            title: "No Bitrate",
            type: "movie",
            Media: [{ videoResolution: "1080" }],
          },
        ],
      },
    });
    const { text } = await callTool(
      register,
      "get_library_contents",
      { section_id: "1", min_bitrate: 10000 },
      client
    );
    assert.match(text, /High Bitrate/);
    assert.doesNotMatch(text, /Low Bitrate/);
    assert.doesNotMatch(text, /No Bitrate/);
  });

  it("excludes items without Media when resolution filter is applied", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/all", {
      MediaContainer: {
        totalSize: 2,
        Metadata: [
          {
            ratingKey: "50",
            title: "Has Media",
            type: "movie",
            Media: [{ videoResolution: "1080", bitrate: 8000 }],
          },
          { ratingKey: "51", title: "No Media", type: "movie" },
        ],
      },
    });
    const { text } = await callTool(
      register,
      "get_library_contents",
      { section_id: "1", resolution: "1080p" },
      client
    );
    assert.match(text, /Has Media/);
    assert.doesNotMatch(text, /No Media/);
  });

  it("returns no-items message when all items filtered out by resolution", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/all", {
      MediaContainer: {
        totalSize: 1,
        Metadata: [
          {
            ratingKey: "60",
            title: "SD Only",
            type: "movie",
            Media: [{ videoResolution: "sd", bitrate: 1000 }],
          },
        ],
      },
    });
    const { text, isError } = await callTool(
      register,
      "get_library_contents",
      { section_id: "1", resolution: "4k" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /No items found/);
  });
});

describe("get_children", () => {
  it("returns seasons for a TV show", async () => {
    const client = makeMockClient();
    client.setResponse("/library/metadata/50/children", {
      MediaContainer: {
        title: "Breaking Bad",
        Metadata: [
          { ratingKey: "51", title: "Season 1", type: "season", parentTitle: "Breaking Bad" },
          { ratingKey: "52", title: "Season 2", type: "season", parentTitle: "Breaking Bad" },
        ],
      },
    });
    const { text, isError } = await callTool(
      register,
      "get_children",
      { rating_key: "50" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /Breaking Bad/);
    assert.match(text, /Season 1/);
    assert.match(text, /Season 2/);
  });

  it("returns message when no children", async () => {
    const client = makeMockClient();
    client.setResponse("/library/metadata/50/children", { MediaContainer: { Metadata: [] } });
    const { text } = await callTool(register, "get_children", { rating_key: "50" }, client);
    assert.match(text, /No children found/);
  });
});

describe("get_media_info", () => {
  it("returns full metadata for an item", async () => {
    const client = makeMockClient();
    client.setResponse("/library/metadata/42", {
      MediaContainer: {
        Metadata: [
          {
            ratingKey: "42",
            title: "Arrival",
            type: "movie",
            year: 2016,
            summary: "A linguist works with the military...",
            rating: 7.9,
            duration: 6840000,
            contentRating: "PG-13",
          },
        ],
      },
    });
    const { text, isError } = await callTool(
      register,
      "get_media_info",
      { rating_key: "42" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /Arrival/);
    assert.match(text, /2016/);
    assert.match(text, /PG-13/);
    assert.match(text, /linguist/);
  });

  it("returns message when item not found", async () => {
    const client = makeMockClient();
    client.setResponse("/library/metadata/999", { MediaContainer: { Metadata: [] } });
    const { text } = await callTool(register, "get_media_info", { rating_key: "999" }, client);
    assert.match(text, /No media found/);
  });

  it("includes media quality fields when Media array is present", async () => {
    const client = makeMockClient();
    client.setResponse("/library/metadata/10", {
      MediaContainer: {
        Metadata: [
          {
            ratingKey: "10",
            title: "Dune",
            type: "movie",
            Media: [
              {
                videoResolution: "4k",
                bitrate: 25000,
                videoCodec: "hevc",
                audioCodec: "eac3",
                audioChannels: 6,
                container: "mkv",
                Part: [{ size: 55834574848 }],
              },
            ],
          },
        ],
      },
    });
    const { text, isError } = await callTool(
      register,
      "get_media_info",
      { rating_key: "10" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /Resolution: 4K/);
    assert.match(text, /Bitrate: 25\.0 Mbps/);
    assert.match(text, /Video Codec: HEVC \(H\.265\)/);
    assert.match(text, /Audio: Dolby Digital Plus 5\.1/);
    assert.match(text, /Container: MKV/);
    assert.match(text, /File Size: 52\.00 GB/);
  });

  it("formats 1080p H.264 AAC Stereo correctly", async () => {
    const client = makeMockClient();
    client.setResponse("/library/metadata/11", {
      MediaContainer: {
        Metadata: [
          {
            ratingKey: "11",
            title: "Interstellar",
            type: "movie",
            Media: [
              {
                videoResolution: "1080",
                bitrate: 8500,
                videoCodec: "h264",
                audioCodec: "aac",
                audioChannels: 2,
                container: "mp4",
                Part: [{ size: 8053063680 }],
              },
            ],
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_media_info", { rating_key: "11" }, client);
    assert.match(text, /Resolution: 1080p/);
    assert.match(text, /Bitrate: 8\.5 Mbps/);
    assert.match(text, /Video Codec: H\.264/);
    assert.match(text, /Audio: AAC Stereo/);
    assert.match(text, /Container: MP4/);
    assert.match(text, /File Size: 7\.50 GB/);
  });

  it("omits media quality section when no Media array", async () => {
    const client = makeMockClient();
    client.setResponse("/library/metadata/12", {
      MediaContainer: {
        Metadata: [{ ratingKey: "12", title: "Old Entry", type: "movie" }],
      },
    });
    const { text } = await callTool(register, "get_media_info", { rating_key: "12" }, client);
    assert.doesNotMatch(text, /Resolution:/);
    assert.doesNotMatch(text, /Bitrate:/);
    assert.doesNotMatch(text, /File Size:/);
  });

  it("handles low-bitrate sub-1Mbps items", async () => {
    const client = makeMockClient();
    client.setResponse("/library/metadata/13", {
      MediaContainer: {
        Metadata: [
          {
            ratingKey: "13",
            title: "Old Show",
            type: "episode",
            Media: [{ videoResolution: "sd", bitrate: 800, videoCodec: "mpeg2video" }],
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_media_info", { rating_key: "13" }, client);
    assert.match(text, /Resolution: SD/);
    assert.match(text, /800 kbps/);
    assert.match(text, /Video Codec: MPEG-2/);
  });
});

describe("get_media_extras", () => {
  it("returns extras for an item", async () => {
    const client = makeMockClient();
    client.setResponse("/library/metadata/42/extras", {
      MediaContainer: {
        Metadata: [
          { ratingKey: "201", title: "Official Trailer", type: "clip" },
          { ratingKey: "202", title: "Behind the Scenes", type: "clip" },
        ],
      },
    });
    const { text, isError } = await callTool(
      register,
      "get_media_extras",
      { rating_key: "42" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /Official Trailer/);
    assert.match(text, /Behind the Scenes/);
  });

  it("returns message when no extras", async () => {
    const client = makeMockClient();
    client.setResponse("/library/metadata/42/extras", { MediaContainer: { Metadata: [] } });
    const { text } = await callTool(register, "get_media_extras", { rating_key: "42" }, client);
    assert.match(text, /No extras found/);
  });
});

// Branch coverage: formatting edge cases
describe("formatting edge cases", () => {
  it("formats item with parentTitle only (album track without grandparent)", async () => {
    const client = makeMockClient();
    client.setResponse("/library/metadata/99/children", {
      MediaContainer: {
        title: "Jazz Album",
        Metadata: [
          { ratingKey: "100", title: "Track One", type: "track", parentTitle: "Jazz Album" },
        ],
      },
    });
    const { text } = await callTool(register, "get_children", { rating_key: "99" }, client);
    assert.match(text, /Jazz Album › Track One/);
  });

  it("formats item with no year, no prefix", async () => {
    const client = makeMockClient();
    client.setResponse("/library/sections/1/all", {
      MediaContainer: {
        totalSize: 1,
        Metadata: [{ ratingKey: "5", title: "No Year Movie", type: "movie" }],
      },
    });
    const { text } = await callTool(register, "get_library_contents", { section_id: "1" }, client);
    assert.match(text, /No Year Movie \[movie\]/);
    assert.doesNotMatch(text, /\(\d{4}\)/);
  });

  it("formats media_info with minimal fields only", async () => {
    const client = makeMockClient();
    client.setResponse("/library/metadata/1", {
      MediaContainer: {
        Metadata: [{ ratingKey: "1", title: "Bare Minimum", type: "movie" }],
      },
    });
    const { text } = await callTool(register, "get_media_info", { rating_key: "1" }, client);
    assert.match(text, /Title: Bare Minimum/);
    assert.doesNotMatch(text, /Year:/);
    assert.doesNotMatch(text, /Summary:/);
  });

  it("formats media_info with all optional fields present", async () => {
    const client = makeMockClient();
    client.setResponse("/library/metadata/2", {
      MediaContainer: {
        Metadata: [
          {
            ratingKey: "2",
            title: "Full Film",
            type: "movie",
            year: 2020,
            summary: "A full summary",
            rating: 8.5,
            duration: 7200000,
            studio: "Some Studio",
            contentRating: "R",
            viewCount: 3,
            grandparentTitle: "Franchise",
            parentTitle: "Volume 1",
            index: 2,
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_media_info", { rating_key: "2" }, client);
    assert.match(text, /Studio: Some Studio/);
    assert.match(text, /Content Rating: R/);
    assert.match(text, /Play Count: 3/);
    assert.match(text, /Show: Franchise/);
    assert.match(text, /Season: Volume 1/);
    assert.match(text, /Episode\/Track: 2/);
    // Duration > 1 hour exercises the hours branch in msToTime
    assert.match(text, /2h 0m 0s/);
  });
});
