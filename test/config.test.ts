import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { validatePlexUrl, loadConfig } from "../src/config.js";

describe("validatePlexUrl", () => {
  it("accepts private IPv4 addresses", async () => {
    await assert.doesNotReject(() => validatePlexUrl("http://192.168.1.100:32400"));
    await assert.doesNotReject(() => validatePlexUrl("http://10.0.0.5:32400"));
    await assert.doesNotReject(() => validatePlexUrl("http://172.16.0.1:32400"));
  });

  it("accepts localhost", async () => {
    await assert.doesNotReject(() => validatePlexUrl("http://localhost:32400"));
    await assert.doesNotReject(() => validatePlexUrl("http://127.0.0.1:32400"));
  });

  it("accepts .local mDNS hostnames", async () => {
    await assert.doesNotReject(() => validatePlexUrl("http://plex-server.local:32400"));
    await assert.doesNotReject(() => validatePlexUrl("http://nas.local:32400"));
  });

  it("accepts https", async () => {
    await assert.doesNotReject(() => validatePlexUrl("https://192.168.1.1:32400"));
  });

  it("accepts IPv6 loopback ::1", async () => {
    await assert.doesNotReject(() => validatePlexUrl("http://[::1]:32400"));
  });

  it("accepts link-local 169.254.x.x", async () => {
    await assert.doesNotReject(() => validatePlexUrl("http://169.254.1.1:32400"));
  });

  it("rejects public IPv6 addresses", async () => {
    await assert.rejects(() => validatePlexUrl("http://[2001:db8::1]:32400"), /SSRF/);
  });

  it("rejects public IPv4 addresses", async () => {
    await assert.rejects(() => validatePlexUrl("http://8.8.8.8:32400"), /SSRF/);
    await assert.rejects(() => validatePlexUrl("http://1.1.1.1:32400"), /SSRF/);
  });

  it("rejects invalid URLs", async () => {
    await assert.rejects(() => validatePlexUrl("not-a-url"), /not a valid URL/);
    await assert.rejects(() => validatePlexUrl(""), /not a valid URL/);
  });

  it("rejects non-http(s) schemes", async () => {
    await assert.rejects(() => validatePlexUrl("ftp://192.168.1.1:32400"), /http/);
  });

  it("calls warn instead of throwing for unresolvable hostnames", async () => {
    const warnings: string[] = [];
    await assert.doesNotReject(() =>
      validatePlexUrl("http://this-hostname-does-not-exist.invalid:32400", (msg) =>
        warnings.push(msg)
      )
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /could not be resolved/);
  });
});

describe("loadConfig", () => {
  let savedEnv: Record<string, string | undefined>;

  before(() => {
    savedEnv = {
      PLEX_URL: process.env["PLEX_URL"],
      PLEX_TOKEN: process.env["PLEX_TOKEN"],
      LOG_LEVEL: process.env["LOG_LEVEL"],
      MCP_PORT: process.env["MCP_PORT"],
      PLEX_CLIENT_ID: process.env["PLEX_CLIENT_ID"],
    };
  });

  after(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  it("rejects when PLEX_URL is missing", async () => {
    delete process.env["PLEX_URL"];
    await assert.rejects(() => loadConfig(), /PLEX_URL/);
  });

  it("rejects invalid LOG_LEVEL", async () => {
    process.env["PLEX_URL"] = "http://192.168.1.1:32400";
    process.env["LOG_LEVEL"] = "verbose";
    await assert.rejects(() => loadConfig(), /LOG_LEVEL/);
  });

  it("rejects invalid MCP_PORT", async () => {
    process.env["PLEX_URL"] = "http://192.168.1.1:32400";
    delete process.env["LOG_LEVEL"];
    process.env["MCP_PORT"] = "notaport";
    await assert.rejects(() => loadConfig(), /MCP_PORT/);
  });

  it("loads valid config with defaults", async () => {
    process.env["PLEX_URL"] = "http://192.168.1.1:32400";
    delete process.env["LOG_LEVEL"];
    delete process.env["MCP_PORT"];
    delete process.env["PLEX_TOKEN"];
    delete process.env["PLEX_CLIENT_ID"];
    const config = await loadConfig();
    assert.equal(config.plexUrl, "http://192.168.1.1:32400");
    assert.equal(config.logLevel, "info");
    assert.equal(config.port, 3000);
    assert.equal(config.plexToken, undefined);
    assert.ok(config.clientId.length > 0);
  });

  it("uses PLEX_TOKEN when set", async () => {
    process.env["PLEX_URL"] = "http://10.0.0.1:32400";
    process.env["PLEX_TOKEN"] = "my-secret-token";
    const config = await loadConfig();
    assert.equal(config.plexToken, "my-secret-token");
  });
});
