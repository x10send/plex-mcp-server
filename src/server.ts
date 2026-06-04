import { loadConfig, validatePlexUrl } from "./config.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const config = await loadConfig();

  const app = buildApp({
    plexUrl: config.plexUrl,
    plexToken: config.plexToken,
    clientId: config.clientId,
    logLevel: config.logLevel,
  });

  // SSRF check with logger wired up (warns if hostname unresolvable)
  await validatePlexUrl(config.plexUrl, (msg) => app.log.warn(msg));

  const address = await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info({ plexUrl: new URL(config.plexUrl).host, address }, "plex-mcp-server started");

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "Shutting down");
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal: ${message}\n`);
  process.exit(1);
});
