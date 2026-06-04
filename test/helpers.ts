import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { IPlexClient } from "../src/plex-client.js";

type AnyRecord = Record<string, unknown>;

export interface MockPlexClient extends IPlexClient {
  setResponse(path: string, response: AnyRecord): void;
  setError(path: string, status: number, message: string): void;
}

export function makeMockClient(): MockPlexClient {
  const responses = new Map<string, AnyRecord>();
  const errors = new Map<string, { status: number; message: string }>();

  return {
    setResponse(path: string, response: AnyRecord) {
      responses.set(path, response);
    },
    setError(path: string, status: number, message: string) {
      errors.set(path, { status, message });
    },
    async get<T>(path: string): Promise<T> {
      const err = errors.get(path);
      if (err) {
        const { PlexApiError } = await import("../src/plex-client.js");
        throw new PlexApiError(err.status, err.message);
      }
      const res = responses.get(path);
      if (res === undefined) {
        throw new Error(`MockPlexClient: no response configured for GET ${path}`);
      }
      return res as T;
    },
  };
}

export type RegisterFn = (server: McpServer, client: IPlexClient) => void;

export interface ToolResult {
  text: string;
  isError: boolean;
}

export async function callTool(
  register: RegisterFn,
  toolName: string,
  args: AnyRecord,
  client: IPlexClient
): Promise<ToolResult> {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  register(server, client);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  const mcpClient = new Client({ name: "test-client", version: "0.0.0" });

  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  const result = await mcpClient.callTool({ name: toolName, arguments: args });

  await mcpClient.close();
  await server.close();

  const text = (result.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("");

  return { text, isError: result.isError === true };
}
