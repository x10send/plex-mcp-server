import { createRequire } from "node:module";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyHelmet from "@fastify/helmet";

const { version: SERVER_VERSION } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { PlexClient } from "./plex-client.js";
import { registerLibraryTools } from "./tools/library.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerLiveTvTools } from "./tools/livetv.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerServerOpsTools } from "./tools/server-ops.js";
import { registerDvrTools } from "./tools/dvr.js";

export interface AppConfig {
  plexUrl: string;
  plexToken: string | undefined;
  clientId: string;
  logLevel: string;
}

function resolveToken(
  headerValue: string | string[] | undefined,
  envToken: string | undefined
): string | undefined {
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return (header && header.length > 0 ? header : undefined) ?? envToken;
}

function buildMcpServer(plexUrl: string, token: string, clientId: string): McpServer {
  const client = new PlexClient({
    baseUrl: plexUrl,
    token,
    clientIdentifier: clientId,
    version: SERVER_VERSION,
  });
  const server = new McpServer({ name: "plex-mcp-server", version: SERVER_VERSION });
  registerLibraryTools(server, client);
  registerDiscoveryTools(server, client);
  registerLiveTvTools(server, client);
  registerSessionTools(server, client);
  registerServerOpsTools(server, client);
  registerDvrTools(server, client);
  return server;
}

export function buildApp(config: AppConfig): FastifyInstance {
  const app = Fastify({
    requestTimeout: 30_000,
    logger: {
      level: config.logLevel,
      redact: {
        paths: ['req.headers["x-plex-token"]', "req.headers.authorization"],
        censor: "[Redacted]",
      },
    },
  });

  void app.register(fastifyRateLimit, {
    max: 60,
    timeWindow: "1 minute",
  });

  void app.register(fastifyHelmet);

  app.get("/health", async (_req, _reply) => {
    return { status: "ok" };
  });

  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    handler: async (req, reply) => {
      const token = resolveToken(
        req.headers["x-plex-token"] as string | string[] | undefined,
        config.plexToken
      );

      if (!token) {
        return reply.status(401).send({
          error:
            "Plex token required. Set PLEX_TOKEN env var or configure X-Plex-Token header injection in mcp-edge-gateway.",
        });
      }

      const mcpServer = buildMcpServer(config.plexUrl, token, config.clientId);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

      try {
        await mcpServer.connect(transport);
      } catch {
        return reply.status(500).send({ error: "Internal error" });
      }
      reply.hijack();
      try {
        await transport.handleRequest(req.raw, reply.raw, req.body);
      } finally {
        await mcpServer.close().catch(() => {});
      }
    },
  });

  return app;
}
