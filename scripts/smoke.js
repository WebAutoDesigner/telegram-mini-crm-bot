import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MiniCrmBotApp } from "../src/app.js";
import { AppDatabase } from "../src/storage/database.js";
import { SessionStore } from "../src/services/session-store.js";
import { LEAD_STATUS } from "../src/domain/constants.js";
import { createHttpServer } from "../src/server.js";

function createTempConfig(tempDir) {
  return {
    owner: {
      telegramId: 1,
      fullName: "Owner",
      username: "owner"
    },
    defaultTimeZone: "Europe/Moscow",
    defaultSummaryTime: "10:00",
    databasePath: path.join(tempDir, "bot.sqlite"),
    botPublicUrl: "https://example.com",
    botWebhookSecret: "secret",
    siteApiKey: "test-site-key"
  };
}

function createTelegramStub() {
  const calls = [];

  return {
    calls,
    client: {
      setWebhook: async () => true,
      sendMessage: async (payload) => {
        calls.push({ method: "sendMessage", payload });
        return { ok: true };
      },
      editMessageText: async (payload) => {
        calls.push({ method: "editMessageText", payload });
        return { ok: true };
      },
      answerCallbackQuery: async (payload) => {
        calls.push({ method: "answerCallbackQuery", payload });
        return true;
      }
    }
  };
}

async function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "telegram-mini-crm-bot-"));
  const config = createTempConfig(tempDir);
  const { calls, client } = createTelegramStub();
  const db = new AppDatabase(config.databasePath, config);
  db.initialize();

  const owner = db.seedOwner();
  const app = new MiniCrmBotApp({
    config,
    db,
    telegramClient: client,
    sessionStore: new SessionStore()
  });

  const server = createHttpServer({ config, app });

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const healthResponse = await fetch(`${baseUrl}/health`);
    if (!healthResponse.ok) {
      throw new Error("Expected /health endpoint to respond with 200");
    }

    const unauthorizedLeadResponse = await fetch(`${baseUrl}/api/leads`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "wrong-key"
      },
      body: JSON.stringify({
        name: "Unauthorized",
        phone: "+79990000000",
        source: "site"
      })
    });

    if (unauthorizedLeadResponse.status !== 401) {
      throw new Error(`Expected unauthorized site lead response, got ${unauthorizedLeadResponse.status}`);
    }

    const unauthorizedWebhookResponse = await fetch(
      `${baseUrl}/telegram/webhook/${config.botWebhookSecret}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      }
    );

    if (unauthorizedWebhookResponse.status !== 401) {
      throw new Error(`Expected unauthorized webhook response, got ${unauthorizedWebhookResponse.status}`);
    }

  const siteResult = await app.handleSiteLead({
    name: "Иван",
    phone: "+79991234567",
    service: "Полировка",
    comment: "Хочу завтра",
    source: "site"
  });

  if (siteResult.action !== "created") {
    throw new Error(`Expected site lead creation, got ${siteResult.action}`);
  }

  const lead = db.getLeadById(siteResult.leadId);
  if (!lead || lead.status !== LEAD_STATUS.NEW) {
    throw new Error("New site lead was not created correctly");
  }

  await app.handleAddLeadSession(owner, owner.telegram_user_id, "+79991234567", {
    type: "add_lead",
    step: "phone",
    draft: {}
  });

  const duplicateSession = app.sessions.get(owner.telegram_user_id);
  if (!duplicateSession || duplicateSession.type !== "add_lead_duplicate") {
    throw new Error("Expected duplicate lead session for active lead");
  }

  db.changeLeadStatus({
    leadId: lead.id,
    status: LEAD_STATUS.LOST,
    nextContactAt: null,
    lostReason: "Дорого"
  });

  app.sessions.clear(owner.telegram_user_id);

  await app.handleAddLeadSession(owner, owner.telegram_user_id, "+79991234567", {
    type: "add_lead",
    step: "phone",
    draft: {}
  });

  const historicalSession = app.sessions.get(owner.telegram_user_id);
  if (!historicalSession || historicalSession.type !== "add_lead_historical") {
    throw new Error("Expected historical client session for closed lead");
  }

  await app.startLeadLostFlow(owner, owner.telegram_user_id, lead, "0");
  await app.handleSessionInput(owner, owner.telegram_user_id, "дорого для клиента", {
    type: "lead_lost_comment",
    leadId: lead.id,
    reason: "Дорого"
  });

  await app.blacklistLeadByReason(owner, owner.telegram_user_id, lead, "0");
  await app.handleSessionInput(owner, owner.telegram_user_id, "спам", {
    type: "lead_blacklist_comment",
    leadId: lead.id,
    reason: "Спам"
  });

  const blacklistEntry = db.getBlacklistByPhone(lead.phone_normalized);
  if (!blacklistEntry) {
    throw new Error("Expected blacklist entry to be created");
  }

  await app.handleCallbackQuery({
    id: "cb-1",
    from: { id: owner.telegram_user_id },
    data: `lead:view:${lead.id}`,
    message: {
      message_id: 77,
      chat: { id: owner.telegram_user_id }
    }
  });

  const usedInlineEdit = calls.some((call) => call.method === "editMessageText");
  if (!usedInlineEdit) {
    throw new Error("Expected callback navigation to edit inline message");
  }

  await app.handleSearchSession(owner, owner.telegram_user_id, "Иван");
  await app.handleCallbackQuery({
    id: "cb-2",
    from: { id: owner.telegram_user_id },
    data: "search:filter:blacklist",
    message: {
      message_id: 78,
      chat: { id: owner.telegram_user_id }
    }
  });

  const editedMessages = calls.filter((call) => call.method === "editMessageText").length;
  if (editedMessages < 2) {
    throw new Error("Expected inline search filtering to edit existing message");
  }

  const counts = await app.getMainMenuCounts(owner);
  if (!Number.isInteger(counts.blacklistCount) || counts.blacklistCount < 1) {
    throw new Error("Expected blacklist count to be available");
  }

    console.log(
      JSON.stringify({
        ok: true,
        messagesSent: calls.filter((call) => call.method === "sendMessage").length,
        editedMessages,
        leadStatus: db.getLeadById(lead.id)?.status,
        blacklistReason: blacklistEntry.reason,
        counts
      })
    );
  } finally {
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
    db.close();
  }
}

run().catch((error) => {
  console.error("[smoke]", error);
  process.exit(1);
});
