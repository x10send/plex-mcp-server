import Fastify, { type FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { PlexClient } from "./plex-client.js";
import { registerLibraryTools } from "./tools/library.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerLiveTvTools } from "./tools/livetv.js";

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
  const client = new PlexClient({ baseUrl: plexUrl, token, clientIdentifier: clientId });
  const server = new McpServer({ name: "plex-mcp-server", version: "0.1.0" });
  registerLibraryTools(server, client);
  registerDiscoveryTools(server, client);
  registerLiveTvTools(server, client);
  return server;
}

export function buildApp(config: AppConfig): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: ['req.headers["x-plex-token"]', "req.headers.authorization"],
        censor: "[Redacted]",
      },
    },
  });

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
        reply.hijack();
        await transport.handleRequest(req.raw, reply.raw, req.body);
      } finally {
        await mcpServer.close().catch(() => {});
      }
    },
  });

  return app;
}
