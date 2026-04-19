import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function loadDotEnvFile() {
  const envPath = path.join(projectRoot, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function resolveDataDir(inputPath) {
  if (!inputPath) {
    return path.join(projectRoot, "data");
  }

  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }

  return path.resolve(projectRoot, inputPath);
}

function readRequired(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

export function loadConfig() {
  loadDotEnvFile();
  const dataDir = resolveDataDir(process.env.DATA_DIR);
  fs.mkdirSync(dataDir, { recursive: true });

  const config = {
    projectRoot,
    env: process.env.NODE_ENV ?? "development",
    port: Number(process.env.PORT ?? 3010),
    botToken: readRequired("BOT_TOKEN"),
    botPublicUrl: readRequired("BOT_PUBLIC_URL").replace(/\/+$/, ""),
    botWebhookSecret: readRequired("BOT_WEBHOOK_SECRET"),
    siteApiKey: readRequired("SITE_API_KEY"),
    dataDir,
    databasePath: path.join(dataDir, "bot.sqlite"),
    defaultTimeZone: process.env.DEFAULT_TIMEZONE ?? "Europe/Moscow",
    defaultSummaryTime: process.env.DEFAULT_SUMMARY_TIME ?? "10:00",
    owner: {
      telegramId: Number(readRequired("OWNER_TELEGRAM_ID")),
      fullName: process.env.OWNER_FULL_NAME ?? "Owner",
      username: process.env.OWNER_USERNAME ?? null
    }
  };

  if (!Number.isFinite(config.owner.telegramId)) {
    throw new Error("OWNER_TELEGRAM_ID must be a valid number");
  }

  return config;
}
