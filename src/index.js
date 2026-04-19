import process from "node:process";

import { MiniCrmBotApp } from "./app.js";
import { loadConfig } from "./config.js";
import { SessionStore } from "./services/session-store.js";
import { AppDatabase } from "./storage/database.js";
import { createHttpServer } from "./server.js";
import { TelegramApiClient } from "./telegram/index.js";

async function main() {
  const config = loadConfig();
  const db = new AppDatabase(config.databasePath, config);
  db.initialize();
  db.seedOwner();

  const telegramClient = new TelegramApiClient(config.botToken);
  const sessionStore = new SessionStore();
  const app = new MiniCrmBotApp({
    config,
    db,
    telegramClient,
    sessionStore
  });

  await app.start();

  const server = createHttpServer({ config, app });
  server.listen(config.port, () => {
    console.log(`[telegram-mini-crm-bot] listening on ${config.port}`);
  });

  const shutdown = () => {
    app.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[telegram-mini-crm-bot] fatal", error);
  process.exit(1);
});
