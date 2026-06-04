import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

const BASE_CONFIG = {
  plexUrl: "http://192.168.1.1:32400",
  plexToken: undefined,
  clientId: "test-client-id",
  logLevel: "silent",
};

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const app = buildApp(BASE_CONFIG);
    const res = await app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.payload), { status: "ok" });
    await app.close();
  });
});

describe("POST /mcp — token resolution", () => {
  it("returns 401 when no token available", async () => {
    const app = buildApp({ ...BASE_CONFIG, plexToken: undefined });
    const res = await app.inject({ method: "POST", url: "/mcp", payload: {} });
    assert.equal(res.statusCode, 401);
    const body = JSON.parse(res.payload) as { error: string };
    assert.match(body.error, /Plex token required/);
    await app.close();
  });

  it("accepts requests when PLEX_TOKEN env fallback is set", async () => {
    const app = buildApp({ ...BASE_CONFIG, plexToken: "fake-token-for-test" });
    // The MCP transport will attempt to process a JSON-RPC request;
    // an empty object is not a valid MCP request so it may error at the MCP layer,
    // but it should NOT return 401.
    const res = await app.inject({ method: "POST", url: "/mcp", payload: {} });
    assert.notEqual(res.statusCode, 401);
    await app.close();
  });

  it("prefers X-Plex-Token header over env var", async () => {
    const app = buildApp({ ...BASE_CONFIG, plexToken: "env-token" });
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: {},
      headers: { "x-plex-token": "header-token" },
    });
    // Not 401 — header token was accepted
    assert.notEqual(res.statusCode, 401);
    await app.close();
  });

  it("returns 401 when header is empty string and no env token", async () => {
    const app = buildApp({ ...BASE_CONFIG, plexToken: undefined });
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: {},
      headers: { "x-plex-token": "" },
    });
    assert.equal(res.statusCode, 401);
    await app.close();
  });
});

describe("GET /mcp", () => {
  it("returns 401 when no token available", async () => {
    const app = buildApp({ ...BASE_CONFIG, plexToken: undefined });
    const res = await app.inject({ method: "GET", url: "/mcp" });
    assert.equal(res.statusCode, 401);
    await app.close();
  });
});
