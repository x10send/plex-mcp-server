import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PlexClient, PlexApiError } from "../src/plex-client.js";

const CONFIG = {
  baseUrl: "http://192.168.1.1:32400",
  token: "test-plex-token",
  clientIdentifier: "test-client-id",
};

let savedFetch: typeof globalThis.fetch;

beforeEach(() => {
  savedFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = savedFetch;
});

function mockFetch(body: unknown, status = 200, contentType = "application/json"): void {
  (globalThis as Record<string, unknown>)["fetch"] = async (_url: string) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": contentType },
    });
  };
}

function mockFetchError(status: number, bodyText = "Error"): void {
  (globalThis as Record<string, unknown>)["fetch"] = async (_url: string) => {
    return new Response(bodyText, { status });
  };
}

describe("PlexClient.get", () => {
  it("returns parsed JSON on success", async () => {
    mockFetch({ MediaContainer: { size: 1 } });
    const client = new PlexClient(CONFIG);
    const data = await client.get<{ MediaContainer: { size: number } }>("/library/sections");
    assert.equal(data.MediaContainer.size, 1);
  });

  it("appends query params to URL", async () => {
    let capturedUrl = "";
    (globalThis as Record<string, unknown>)["fetch"] = async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = new PlexClient(CONFIG);
    await client.get("/search", { query: "test", limit: "10" });
    assert.match(capturedUrl, /query=test/);
    assert.match(capturedUrl, /limit=10/);
  });

  it("sends X-Plex-Token header", async () => {
    let capturedInit: RequestInit | undefined;
    (globalThis as Record<string, unknown>)["fetch"] = async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = new PlexClient(CONFIG);
    await client.get("/test");
    const headers = capturedInit?.headers as Record<string, string>;
    assert.equal(headers["X-Plex-Token"], "test-plex-token");
  });

  it("throws PlexApiError on 401", async () => {
    mockFetchError(401, "Unauthorized");
    const client = new PlexClient(CONFIG);
    await assert.rejects(
      () => client.get("/protected"),
      (err: unknown) => {
        assert.ok(err instanceof PlexApiError);
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  it("throws PlexApiError on 500 with body text", async () => {
    mockFetchError(500, "Internal Server Error");
    const client = new PlexClient(CONFIG);
    await assert.rejects(
      () => client.get("/broken"),
      (err: unknown) => {
        assert.ok(err instanceof PlexApiError);
        assert.equal(err.status, 500);
        assert.match(err.message, /Internal Server Error/);
        return true;
      }
    );
  });

  it("handles error response with empty body", async () => {
    (globalThis as Record<string, unknown>)["fetch"] = async () => {
      return new Response("", { status: 503, statusText: "Service Unavailable" });
    };
    const client = new PlexClient(CONFIG);
    await assert.rejects(
      () => client.get("/down"),
      (err: unknown) => {
        assert.ok(err instanceof PlexApiError);
        assert.equal(err.status, 503);
        return true;
      }
    );
  });
});

describe("PlexClient.delete — empty response bodies", () => {
  it("succeeds when Plex returns 200 with empty body", async () => {
    (globalThis as Record<string, unknown>)["fetch"] = async () => {
      return new Response("", { status: 200 });
    };
    const client = new PlexClient(CONFIG);
    const result = await client.delete<unknown>("/dvr/subscriptions/42");
    assert.equal(result, undefined);
  });

  it("succeeds when Plex returns 204 No Content", async () => {
    (globalThis as Record<string, unknown>)["fetch"] = async () => {
      return new Response(null, { status: 204 });
    };
    const client = new PlexClient(CONFIG);
    const result = await client.delete<unknown>("/dvr/subscriptions/42");
    assert.equal(result, undefined);
  });
});

describe("PlexApiError", () => {
  it("has correct name and status", () => {
    const err = new PlexApiError(404, "Not found");
    assert.equal(err.name, "PlexApiError");
    assert.equal(err.status, 404);
    assert.match(err.message, /Not found/);
    assert.ok(err instanceof Error);
  });
});
