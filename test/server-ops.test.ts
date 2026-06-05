import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerServerOpsTools } from "../src/tools/server-ops.js";
import { makeMockClient, callTool, type RegisterFn } from "./helpers.js";

const register: RegisterFn = registerServerOpsTools;

// ── get_server_info ───────────────────────────────────────────────────────────

describe("get_server_info", () => {
  it("returns full server info", async () => {
    const client = makeMockClient();
    client.setResponse("/", {
      MediaContainer: {
        friendlyName: "Homelab",
        version: "1.40.0.1234-abc",
        platform: "Linux",
        platformVersion: "6.1.0",
        machineIdentifier: "abc123xyz",
        myPlexUsername: "user@example.com",
        myPlexSubscription: true,
        transcoderActiveVideoSessions: 2,
        livetv: 7,
        updatedAt: 1717200000,
      },
    });
    const { text, isError } = await callTool(register, "get_server_info", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Homelab/);
    assert.match(text, /1\.40\.0/);
    assert.match(text, /Linux/);
    assert.match(text, /6\.1\.0/);
    assert.match(text, /abc123xyz/);
    assert.match(text, /user@example\.com/);
    assert.match(text, /Plex Pass: yes/);
    assert.match(text, /Active video transcodes: 2/);
    assert.match(text, /Live TV: available/);
    assert.match(text, /Last updated:/);
  });

  it("shows 'no' for Plex Pass and 'not configured' for Live TV when absent", async () => {
    const client = makeMockClient();
    client.setResponse("/", {
      MediaContainer: {
        friendlyName: "Server",
        version: "1.0.0",
        platform: "Linux",
        machineIdentifier: "id1",
        myPlexSubscription: false,
        transcoderActiveVideoSessions: 0,
      },
    });
    const { text } = await callTool(register, "get_server_info", {}, client);
    assert.match(text, /Plex Pass: no/);
    assert.match(text, /Live TV: not configured/);
    assert.doesNotMatch(text, /Last updated/);
  });

  it("handles missing optional fields gracefully", async () => {
    const client = makeMockClient();
    client.setResponse("/", { MediaContainer: {} });
    const { text, isError } = await callTool(register, "get_server_info", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Name: Unknown/);
    assert.match(text, /Version: Unknown/);
  });

  it("returns error on API failure", async () => {
    const client = makeMockClient();
    client.setError("/", 500, "Server error");
    const { isError } = await callTool(register, "get_server_info", {}, client);
    assert.equal(isError, true);
  });
});

// ── get_server_statistics ─────────────────────────────────────────────────────

describe("get_server_statistics", () => {
  it("returns bandwidth stats with LAN and WAN breakdown", async () => {
    const client = makeMockClient();
    client.setResponse("/statistics/bandwidth", {
      MediaContainer: {
        StatisticsBandwidth: [
          { bytes: 1_500_000_000, direction: 0 }, // LAN: 1.5 GB
          { bytes: 500_000_000, direction: 1 }, // WAN: 500 MB
        ],
      },
    });
    const { text, isError } = await callTool(register, "get_server_statistics", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Bandwidth statistics \(last days\)/);
    assert.match(text, /Total:/);
    assert.match(text, /LAN:/);
    assert.match(text, /WAN:/);
    assert.match(text, /GB/);
    assert.match(text, /Data points: 2/);
  });

  it("accepts timespan parameter", async () => {
    const client = makeMockClient();
    client.setResponse("/statistics/bandwidth", {
      MediaContainer: {
        StatisticsBandwidth: [{ bytes: 100_000, direction: 0 }],
      },
    });
    const { text } = await callTool(
      register,
      "get_server_statistics",
      { timespan: "weeks" },
      client
    );
    assert.match(text, /last weeks/);
  });

  it("sends timespan code 6 for hours", async () => {
    const client = makeMockClient();
    client.setResponse("/statistics/bandwidth", {
      MediaContainer: { StatisticsBandwidth: [{ bytes: 1000, direction: 0 }] },
    });
    await callTool(register, "get_server_statistics", { timespan: "hours" }, client);
    assert.equal(client.getLastGetParams()?.["timespan"], "6");
  });

  it("sends timespan code 4 for days (default)", async () => {
    const client = makeMockClient();
    client.setResponse("/statistics/bandwidth", {
      MediaContainer: { StatisticsBandwidth: [{ bytes: 1000, direction: 0 }] },
    });
    await callTool(register, "get_server_statistics", {}, client);
    assert.equal(client.getLastGetParams()?.["timespan"], "4");
  });

  it("sends timespan code 3 for weeks", async () => {
    const client = makeMockClient();
    client.setResponse("/statistics/bandwidth", {
      MediaContainer: { StatisticsBandwidth: [{ bytes: 1000, direction: 0 }] },
    });
    await callTool(register, "get_server_statistics", { timespan: "weeks" }, client);
    assert.equal(client.getLastGetParams()?.["timespan"], "3");
  });

  it("sends timespan code 2 for months", async () => {
    const client = makeMockClient();
    client.setResponse("/statistics/bandwidth", {
      MediaContainer: { StatisticsBandwidth: [{ bytes: 1000, direction: 0 }] },
    });
    await callTool(register, "get_server_statistics", { timespan: "months" }, client);
    assert.equal(client.getLastGetParams()?.["timespan"], "2");
  });

  it("returns no-stats message when empty", async () => {
    const client = makeMockClient();
    client.setResponse("/statistics/bandwidth", {
      MediaContainer: { StatisticsBandwidth: [] },
    });
    const { text } = await callTool(register, "get_server_statistics", {}, client);
    assert.match(text, /No bandwidth statistics/);
  });

  it("returns error on API failure", async () => {
    const client = makeMockClient();
    client.setError("/statistics/bandwidth", 500, "Error");
    const { isError } = await callTool(register, "get_server_statistics", {}, client);
    assert.equal(isError, true);
  });

  it("formats bytes correctly across all ranges", async () => {
    const client = makeMockClient();
    // Test GB range
    client.setResponse("/statistics/bandwidth", {
      MediaContainer: {
        StatisticsBandwidth: [{ bytes: 2_000_000_000, direction: 0 }],
      },
    });
    const { text: gbText } = await callTool(register, "get_server_statistics", {}, client);
    assert.match(gbText, /GB/);

    // Test MB range
    client.setResponse("/statistics/bandwidth", {
      MediaContainer: {
        StatisticsBandwidth: [{ bytes: 5_000_000, direction: 0 }],
      },
    });
    const { text: mbText } = await callTool(register, "get_server_statistics", {}, client);
    assert.match(mbText, /MB/);

    // Test KB range
    client.setResponse("/statistics/bandwidth", {
      MediaContainer: {
        StatisticsBandwidth: [{ bytes: 50_000, direction: 0 }],
      },
    });
    const { text: kbText } = await callTool(register, "get_server_statistics", {}, client);
    assert.match(kbText, /KB/);

    // Test bytes range
    client.setResponse("/statistics/bandwidth", {
      MediaContainer: {
        StatisticsBandwidth: [{ bytes: 500, direction: 0 }],
      },
    });
    const { text: bText } = await callTool(register, "get_server_statistics", {}, client);
    assert.match(bText, /500 B/);
  });
});

// ── get_activities ────────────────────────────────────────────────────────────

describe("get_activities", () => {
  it("returns no-activities message when empty", async () => {
    const client = makeMockClient();
    client.setResponse("/activities", { MediaContainer: { Activity: [] } });
    const { text } = await callTool(register, "get_activities", {}, client);
    assert.match(text, /No active background activities/);
  });

  it("groups activities by type with recordings first", async () => {
    const client = makeMockClient();
    client.setResponse("/activities", {
      MediaContainer: {
        Activity: [
          { title: "Refreshing Sub", subtitle: "file.srt", progress: 50, cancellable: false },
          { title: "Refreshing Sub", subtitle: "other.srt", progress: 0, cancellable: false },
          { title: "Recording", subtitle: "Joe Kidd", progress: 9, cancellable: true },
        ],
      },
    });
    const { text, isError } = await callTool(register, "get_activities", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Background activities \(3\)/);
    // Recording section appears before Subtitle section
    const recIdx = text.indexOf("Recordings");
    const subIdx = text.indexOf("Subtitle");
    assert.ok(recIdx < subIdx, "Recordings section should precede Subtitle section");
    assert.match(text, /Recordings \(1\)/);
    assert.match(text, /Recording/);
    assert.match(text, /\[cancellable\]/);
  });

  it("collapses repetitive subtitle jobs into a summary line", async () => {
    const client = makeMockClient();
    const subtitles = Array.from({ length: 10 }, (_, i) => ({
      title: "Refreshing Sub",
      subtitle: `file${i}.srt`,
      progress: i * 5,
      cancellable: false,
    }));
    client.setResponse("/activities", { MediaContainer: { Activity: subtitles } });
    const { text } = await callTool(register, "get_activities", {}, client);
    assert.match(text, /Subtitle Refresh \(10\):/);
    assert.match(text, /10 jobs in progress/);
    assert.match(text, /avg/);
    // Individual file paths should NOT be listed
    assert.doesNotMatch(text, /file0\.srt/);
  });

  it("lists individual items when below collapse threshold", async () => {
    const client = makeMockClient();
    client.setResponse("/activities", {
      MediaContainer: {
        Activity: [
          {
            title: "Scanning Movies",
            subtitle: "Processing /media/movies",
            progress: 42,
            cancellable: true,
          },
          { title: "Refreshing metadata", progress: 80, cancellable: false },
        ],
      },
    });
    const { text, isError } = await callTool(register, "get_activities", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Background activities \(2\)/);
    assert.match(text, /Scanning Movies/);
    assert.match(text, /\[cancellable\]/);
    assert.match(text, /Processing \/media\/movies/);
    assert.match(text, /Progress: 42%/);
    assert.match(text, /Refreshing metadata/);
    assert.equal((text.match(/\[cancellable\]/g) ?? []).length, 1);
  });

  it("shows stalled count in collapsed summary", async () => {
    const client = makeMockClient();
    const jobs = [
      { title: "Refreshing Sub", progress: 0 },
      { title: "Refreshing Sub", progress: 0 },
      { title: "Refreshing Sub", progress: 0 },
      { title: "Refreshing Sub", progress: 50 },
    ];
    client.setResponse("/activities", { MediaContainer: { Activity: jobs } });
    const { text } = await callTool(register, "get_activities", {}, client);
    assert.match(text, /stalled/);
  });

  it("type=recording returns only recording tasks", async () => {
    const client = makeMockClient();
    client.setResponse("/activities", {
      MediaContainer: {
        Activity: [
          { title: "Recording", subtitle: "Joe Kidd", progress: 9, cancellable: true },
          { title: "Refreshing Sub", progress: 50 },
          { title: "Recording", subtitle: "Matlock S4E14", progress: 18, cancellable: true },
        ],
      },
    });
    const { text, isError } = await callTool(
      register,
      "get_activities",
      { type: "recording" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /Recordings \(2\)/);
    assert.match(text, /Joe Kidd/);
    assert.match(text, /Matlock/);
    assert.doesNotMatch(text, /Refreshing Sub/);
  });

  it("type=subtitle returns only subtitle tasks", async () => {
    const client = makeMockClient();
    client.setResponse("/activities", {
      MediaContainer: {
        Activity: [
          { title: "Recording", subtitle: "Movie", progress: 9 },
          { title: "Refreshing Sub", progress: 50 },
        ],
      },
    });
    const { text } = await callTool(register, "get_activities", { type: "subtitle" }, client);
    assert.match(text, /Subtitle Refresh \(1\)/);
    assert.doesNotMatch(text, /Recording/);
  });

  it("type filter returns no-match message when nothing matches", async () => {
    const client = makeMockClient();
    client.setResponse("/activities", {
      MediaContainer: {
        Activity: [{ title: "Refreshing Sub", progress: 50 }],
      },
    });
    const { text, isError } = await callTool(
      register,
      "get_activities",
      { type: "recording" },
      client
    );
    assert.equal(isError, false);
    assert.match(text, /No active recording activities/);
  });

  it("classifies DVR type field as recording", async () => {
    const client = makeMockClient();
    client.setResponse("/activities", {
      MediaContainer: {
        Activity: [
          {
            type: "DVRRecorderActivity.Record",
            title: "DVR Record",
            progress: 45,
            cancellable: true,
          },
        ],
      },
    });
    const { text } = await callTool(register, "get_activities", { type: "recording" }, client);
    assert.match(text, /Recordings \(1\)/);
    assert.match(text, /DVR Record/);
  });

  it("handles activity with no subtitle or progress", async () => {
    const client = makeMockClient();
    client.setResponse("/activities", {
      MediaContainer: {
        Activity: [{ title: "Minimal Task", cancellable: false }],
      },
    });
    const { text, isError } = await callTool(register, "get_activities", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Minimal Task/);
    assert.doesNotMatch(text, /Progress/);
  });

  it("returns error on API failure", async () => {
    const client = makeMockClient();
    client.setError("/activities", 500, "Error");
    const { isError } = await callTool(register, "get_activities", {}, client);
    assert.equal(isError, true);
  });
});

// ── get_butler_tasks ──────────────────────────────────────────────────────────

describe("get_butler_tasks", () => {
  it("returns butler task list with schedule and last run", async () => {
    const client = makeMockClient();
    client.setResponse("/butler", {
      MediaContainer: {
        ButlerTask: [
          {
            name: "BackupDatabase",
            title: "Backup Database",
            enabled: true,
            schedule: "02:00",
            lastExecution: 1717200000,
            nextExecution: 1717286400,
            lastExecutionResult: "Succeeded",
          },
          {
            name: "CleanOldBundles",
            title: "Clean Old Bundles",
            enabled: false,
            schedule: "03:00",
          },
        ],
      },
    });
    const { text, isError } = await callTool(register, "get_butler_tasks", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Butler tasks \(2\)/);
    assert.match(text, /Backup Database/);
    assert.match(text, /Schedule: 02:00/);
    assert.match(text, /Last result: Succeeded/);
    assert.match(text, /Last run:/);
    assert.match(text, /Next run:/);
    assert.match(text, /Clean Old Bundles/);
    assert.match(text, /\[disabled\]/);
  });

  it("uses name as fallback when title missing", async () => {
    const client = makeMockClient();
    client.setResponse("/butler", {
      MediaContainer: {
        ButlerTask: [{ name: "SomeTask", enabled: true }],
      },
    });
    const { text } = await callTool(register, "get_butler_tasks", {}, client);
    assert.match(text, /SomeTask/);
  });

  it("returns no-tasks message when empty", async () => {
    const client = makeMockClient();
    client.setResponse("/butler", { MediaContainer: { ButlerTask: [] } });
    const { text } = await callTool(register, "get_butler_tasks", {}, client);
    assert.match(text, /No butler tasks found/);
  });

  it("handles task with no optional fields", async () => {
    const client = makeMockClient();
    client.setResponse("/butler", {
      MediaContainer: {
        ButlerTask: [{ title: "Bare Task", enabled: true }],
      },
    });
    const { text, isError } = await callTool(register, "get_butler_tasks", {}, client);
    assert.equal(isError, false);
    assert.match(text, /Bare Task/);
    assert.doesNotMatch(text, /Schedule/);
    assert.doesNotMatch(text, /Last run/);
  });

  it("returns error on API failure", async () => {
    const client = makeMockClient();
    client.setError("/butler", 500, "Error");
    const { isError } = await callTool(register, "get_butler_tasks", {}, client);
    assert.equal(isError, true);
  });
});
