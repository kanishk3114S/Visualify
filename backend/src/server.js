import { loadConfig, loadEnvFiles } from "./config/env.js";
import { createApp } from "./app.js";
import { createLogger } from "./utils/logger.js";

loadEnvFiles();

let config;
try {
  config = loadConfig();
} catch (err) {
  // Message lists variable names only, never values.
  console.error(err.message);
  process.exit(1);
}

const logger = createLogger(config);
const app = createApp({ config, logger });

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, origins: config.frontendOrigins }, "Visualify API listening");
});

server.headersTimeout = 30_000;
server.requestTimeout = 60_000;

function shutdown(signal) {
  logger.info({ signal }, "shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled rejection");
});
