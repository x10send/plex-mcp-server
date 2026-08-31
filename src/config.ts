import { isIPv4, isIPv6 } from "node:net";
import { lookup } from "node:dns/promises";
import { randomUUID } from "node:crypto";

export interface Config {
  plexUrl: string;
  plexToken: string | undefined;
  clientId: string;
  port: number;
  logLevel: string;
}

// Octet comparison avoids JS signed 32-bit bitwise operator pitfalls for IPs with high bit set.
function isPrivateIPv4(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 51 || b === 18 || b === 19)) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPrivateIPv6(ip: string): boolean {
  const n = ip.toLowerCase();
  return (
    n === "::1" ||
    n.startsWith("fc") ||
    n.startsWith("fd") ||
    n.startsWith("fe80:") ||
    n.startsWith("::ffff:")
  );
}

function isPrivateAddress(addr: string): boolean {
  if (isIPv4(addr)) return isPrivateIPv4(addr);
  if (isIPv6(addr)) return isPrivateIPv6(addr);
  return false;
}

export async function validatePlexUrl(
  rawUrl: string,
  warn: (msg: string) => void = () => {}
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`PLEX_URL is not a valid URL: "${rawUrl}"`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`PLEX_URL must use http:// or https://. Got: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  if (hostname === "localhost" || hostname === "::1") return;
  if (hostname.endsWith(".local")) return;

  if (isIPv4(hostname) || isIPv6(hostname)) {
    if (!isPrivateAddress(hostname)) {
      throw new Error(
        `SSRF: PLEX_URL must point to a private network address. ` +
          `"${hostname}" is a public IP. Use a LAN address (e.g. 192.168.x.x, 10.x.x.x).`
      );
    }
    return;
  }

  try {
    const addresses = await lookup(hostname, { all: true });
    for (const { address } of addresses) {
      if (!isPrivateAddress(address)) {
        throw new Error(
          `SSRF: PLEX_URL hostname "${hostname}" resolves to public IP ${address}. ` +
            `Must point to a private network address.`
        );
      }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      warn(
        `PLEX_URL hostname "${hostname}" could not be resolved at startup — ` +
          `Plex server may be offline. SSRF check skipped; will fail on first request if unreachable.`
      );
    } else {
      throw err;
    }
  }
}

const VALID_LOG_LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal", "silent"]);

export async function loadConfig(): Promise<Config> {
  const plexUrl = process.env["PLEX_URL"];
  if (!plexUrl) throw new Error("PLEX_URL environment variable is required.");

  const logLevel = process.env["LOG_LEVEL"] ?? "info";
  if (!VALID_LOG_LEVELS.has(logLevel)) {
    throw new Error(
      `LOG_LEVEL must be one of: ${[...VALID_LOG_LEVELS].join(", ")}. Got: "${logLevel}"`
    );
  }

  const port = parseInt(process.env["MCP_PORT"] ?? "3000", 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(
      `MCP_PORT must be a valid port number (1–65535). Got: "${process.env["MCP_PORT"]}"`
    );
  }

  return {
    plexUrl: plexUrl.replace(/\/$/, ""),
    plexToken: process.env["PLEX_TOKEN"] || undefined,
    clientId: process.env["PLEX_CLIENT_ID"] || randomUUID(),
    port,
    logLevel,
  };
}
