import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MiniCrmBotApp } from "../src/app.js";
import {
  APPOINTMENT_STATUS,
  LEAD_STATUS,
  SOURCE_TYPE
} from "../src/domain/constants.js";
import { normalizePhone } from "../src/domain/phone.js";
import { SessionStore } from "../src/services/session-store.js";
import { AppDatabase } from "../src/storage/database.js";
import { buildLocalDateTimeFromParts, getZonedDateTimeParts } from "../src/utils/index.js";

function createTelegramStub() {
  const calls = [];

  return {
    calls,
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
      return { ok: true };
    },
    setWebhook: async (payload) => {
      calls.push({ method: "setWebhook", payload });
      return { ok: true };
    }
  };
}

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

function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "telegram-mini-crm-bot-test-"));
  const config = createTempConfig(tempDir);
  const telegram = createTelegramStub();
  const db = new AppDatabase(config.databasePath, config);
  db.initialize();
  const owner = db.seedOwner();
  const app = new MiniCrmBotApp({
    config,
    db,
    telegramClient: telegram,
    sessionStore: new SessionStore()
  });

  return {
    app,
    db,
    owner,
    telegram,
    cleanup() {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function createLead(db, overrides = {}) {
  const phone = overrides.phone ?? "+79990000001";

  return db.createLead({
    creatorUserId: overrides.creatorUserId ?? 1,
    name: overrides.name ?? "Lead",
    phone,
    phoneNormalized: normalizePhone(phone),
    service: overrides.service ?? "Полировка",
    sourceType: overrides.sourceType ?? SOURCE_TYPE.MANUAL,
    sourceLabel: overrides.sourceLabel ?? "Ручное добавление",
    status: overrides.status ?? LEAD_STATUS.NEW,
    nextContactAt: overrides.nextContactAt ?? null,
    lostReason: overrides.lostReason ?? null
  });
}

function buildZonedInstant(timeZone, dayOffset, hour, minute) {
  const parts = getZonedDateTimeParts(new Date(), timeZone);
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset));

  return buildLocalDateTimeFromParts(
    {
      year: base.getUTCFullYear(),
      month: base.getUTCMonth() + 1,
      day: base.getUTCDate(),
      hour,
      minute
    },
    timeZone
  );
}

test("nav:main clears an active session before returning to the main menu", async () => {
  const { app, owner, telegram, cleanup } = createTestContext();

  try {
    app.sessions.set(owner.telegram_user_id, {
      type: "search_results",
      query: "Иван",
      filter: "all"
    });

    await app.handleCallbackQuery({
      id: "cb-nav-main",
      from: { id: owner.telegram_user_id },
      data: "nav:main",
      message: {
        message_id: 101,
        chat: { id: owner.telegram_user_id }
      }
    });

    assert.equal(app.sessions.get(owner.telegram_user_id), null);
    assert.ok(telegram.calls.some((call) => call.method === "answerCallbackQuery"));
    assert.ok(telegram.calls.some((call) => call.method === "sendMessage"));
  } finally {
    cleanup();
  }
});

test("editing a lead phone rejects blacklisted numbers", async () => {
  const { app, db, owner, cleanup } = createTestContext();

  try {
    const lead = createLead(db, {
      phone: "+79990000001",
      status: LEAD_STATUS.IN_PROGRESS
    });
    const blockedPhone = "+79990000099";

    db.addBlacklistEntry({
      phone: blockedPhone,
      phoneNormalized: normalizePhone(blockedPhone),
      reason: "Спам",
      actorUserId: owner.id
    });

    await app.handleLeadEditSession(owner, owner.telegram_user_id, blockedPhone, {
      leadId: lead.id,
      field: "phone"
    });

    const updatedLead = db.getLeadById(lead.id);
    assert.equal(updatedLead.phone_normalized, normalizePhone("+79990000001"));
  } finally {
    cleanup();
  }
});

test("editing a lead phone rejects duplicates from another active lead", async () => {
  const { app, db, owner, cleanup } = createTestContext();

  try {
    const leadA = createLead(db, {
      phone: "+79990000001",
      name: "Lead A",
      status: LEAD_STATUS.IN_PROGRESS
    });
    const leadB = createLead(db, {
      phone: "+79990000002",
      name: "Lead B",
      status: LEAD_STATUS.WAITING_DECISION
    });

    await app.handleLeadEditSession(owner, owner.telegram_user_id, leadB.phone, {
      leadId: leadA.id,
      field: "phone"
    });

    const updatedLead = db.getLeadById(leadA.id);
    assert.equal(updatedLead.phone_normalized, normalizePhone("+79990000001"));
  } finally {
    cleanup();
  }
});

test("repeated access requests do not create duplicate owner notifications", async () => {
  const { app, db, owner, telegram, cleanup } = createTestContext();
  const requesterId = 777;
  const requesterMessage = {
    chat: { id: requesterId },
    from: {
      id: requesterId,
      first_name: "Test",
      last_name: "User",
      username: "test_user"
    }
  };

  try {
    await app.handleUnauthorizedMessage(requesterMessage, "/access");
    await app.handleUnauthorizedMessage(requesterMessage, "/access");

    const ownerMessages = telegram.calls.filter(
      (call) => call.method === "sendMessage" && call.payload.chat_id === owner.telegram_user_id
    );
    const requesterNotifications = telegram.calls.filter(
      (call) => call.method === "sendMessage" && call.payload.chat_id === requesterId
    );

    assert.equal(ownerMessages.length, 1);
    assert.equal(requesterNotifications.length, 2);
    assert.equal(db.listPendingAccessRequests().length, 1);
  } finally {
    cleanup();
  }
});

test("creating a lead from blacklist keeps the number blocked until the lead is fully created", async () => {
  const { app, db, owner, cleanup } = createTestContext();
  const phone = "+79990000111";
  const phoneNormalized = normalizePhone(phone);

  try {
    db.addBlacklistEntry({
      phone,
      phoneNormalized,
      nameLabel: "Old lead",
      reason: "Спам",
      actorUserId: owner.id
    });

    await app.handleCreateLeadFromBlacklist(owner, owner.telegram_user_id, phoneNormalized);
    assert.ok(db.getBlacklistByPhone(phoneNormalized));

    await app.handleAddLeadSession(owner, owner.telegram_user_id, "Новый клиент", app.sessions.get(owner.telegram_user_id));
    await app.handleAddLeadSession(owner, owner.telegram_user_id, "-", app.sessions.get(owner.telegram_user_id));
    await app.handleAddLeadSession(owner, owner.telegram_user_id, "Химчистка", app.sessions.get(owner.telegram_user_id));
    await app.handleAddLeadSession(owner, owner.telegram_user_id, "-", app.sessions.get(owner.telegram_user_id));

    assert.equal(db.getBlacklistByPhone(phoneNormalized), null);
    assert.ok(db.findActiveLeadByPhone(phoneNormalized));
  } finally {
    cleanup();
  }
});

test("failed lead creation from blacklist does not remove the blacklist entry", async () => {
  const { app, db, owner, cleanup } = createTestContext();
  const phone = "+79990000112";
  const phoneNormalized = normalizePhone(phone);
  const originalCreateLead = db.createLead.bind(db);

  try {
    db.addBlacklistEntry({
      phone,
      phoneNormalized,
      nameLabel: "Blocked",
      reason: "Спам",
      actorUserId: owner.id
    });

    await app.handleCreateLeadFromBlacklist(owner, owner.telegram_user_id, phoneNormalized);
    await app.handleAddLeadSession(owner, owner.telegram_user_id, "Клиент", app.sessions.get(owner.telegram_user_id));
    await app.handleAddLeadSession(owner, owner.telegram_user_id, "-", app.sessions.get(owner.telegram_user_id));
    await app.handleAddLeadSession(owner, owner.telegram_user_id, "-", app.sessions.get(owner.telegram_user_id));

    db.createLead = () => {
      throw new Error("boom");
    };

    await assert.rejects(
      app.handleAddLeadSession(owner, owner.telegram_user_id, "-", app.sessions.get(owner.telegram_user_id)),
      /boom/
    );

    assert.ok(db.getBlacklistByPhone(phoneNormalized));
  } finally {
    db.createLead = originalCreateLead;
    cleanup();
  }
});

test("dashboard counts only active appointments for today and tomorrow", async () => {
  const { app, db, owner, cleanup } = createTestContext();

  try {
    const lead = createLead(db, {
      phone: "+79990000113",
      status: LEAD_STATUS.BOOKED
    });

    db.createAppointment({
      leadId: lead.id,
      service: "Полировка",
      appointmentAt: buildZonedInstant(owner.timezone, 0, 12, 0).toISOString(),
      status: APPOINTMENT_STATUS.SCHEDULED
    });
    db.createAppointment({
      leadId: lead.id,
      service: "Полировка",
      appointmentAt: buildZonedInstant(owner.timezone, 0, 13, 0).toISOString(),
      status: APPOINTMENT_STATUS.CANCELED
    });
    db.createAppointment({
      leadId: lead.id,
      service: "Химчистка",
      appointmentAt: buildZonedInstant(owner.timezone, 1, 11, 0).toISOString(),
      status: APPOINTMENT_STATUS.RESCHEDULED
    });
    db.createAppointment({
      leadId: lead.id,
      service: "Химчистка",
      appointmentAt: buildZonedInstant(owner.timezone, 1, 15, 0).toISOString(),
      status: APPOINTMENT_STATUS.COMPLETED
    });

    const counts = await app.getMainMenuCounts(owner);

    assert.equal(counts.todayAppointments, 1);
    assert.equal(counts.tomorrowAppointments, 1);
  } finally {
    cleanup();
  }
});

test("daily summary opens day overviews instead of jumping straight into contacts", async () => {
  const { app, owner, telegram, cleanup } = createTestContext();

  try {
    await app.sendDailySummary(owner);

    const summaryMessage = telegram.calls.find(
      (call) => call.method === "sendMessage" && call.payload.chat_id === owner.telegram_user_id
    );

    assert.ok(summaryMessage);
    const buttons = summaryMessage.payload.reply_markup.inline_keyboard.flat();
    const callbackData = buttons.map((button) => button.callback_data).filter(Boolean);

    assert.ok(callbackData.includes("day:view:today:overview"));
    assert.ok(callbackData.includes("day:view:tomorrow:overview"));
    assert.ok(!callbackData.includes("day:view:today:contacts"));
    assert.ok(!callbackData.includes("day:view:tomorrow:contacts"));
  } finally {
    cleanup();
  }
});

test("callback text prompt edits the current lead card and returns to it without extra bot messages", async () => {
  const { app, db, owner, telegram, cleanup } = createTestContext();

  try {
    const lead = createLead(db, {
      phone: "+79990000114",
      status: LEAD_STATUS.IN_PROGRESS
    });

    await app.handleCallbackQuery({
      id: "cb-comment",
      from: { id: owner.telegram_user_id },
      data: `lead:comment:${lead.id}`,
      message: {
        message_id: 301,
        chat: { id: owner.telegram_user_id }
      }
    });

    assert.equal(app.sessions.get(owner.telegram_user_id)?.sourceMessageId, 301);
    assert.ok(
      telegram.calls.some(
        (call) =>
          call.method === "editMessageText" &&
          call.payload.message_id === 301 &&
          call.payload.text === "Введите новый комментарий для лида."
      )
    );

    telegram.calls.length = 0;
    await app.handleSessionInput(owner, owner.telegram_user_id, "Новый комментарий", app.sessions.get(owner.telegram_user_id));

    assert.equal(app.sessions.get(owner.telegram_user_id), null);
    assert.ok(
      telegram.calls.some(
        (call) =>
          call.method === "editMessageText" &&
          call.payload.message_id === 301 &&
          call.payload.text.includes("Новый комментарий")
      )
    );
    assert.equal(telegram.calls.filter((call) => call.method === "sendMessage").length, 0);
  } finally {
    cleanup();
  }
});

test("deleting a lead sends one main-menu message instead of a separate confirmation", async () => {
  const { app, db, owner, telegram, cleanup } = createTestContext();

  try {
    const lead = createLead(db, {
      phone: "+79990000115",
      status: LEAD_STATUS.IN_PROGRESS
    });

    await app.deleteLead(owner, owner.telegram_user_id, lead);

    const messages = telegram.calls.filter((call) => call.method === "sendMessage");
    assert.equal(messages.length, 1);
    assert.equal(messages[0].payload.text, "Лид удален.");
    assert.ok(messages[0].payload.reply_markup?.keyboard);
  } finally {
    cleanup();
  }
});

test("public /start is treated as a client greeting, not an access request", async () => {
  const { app, db, owner, telegram, cleanup } = createTestContext();

  try {
    await app.handleUnauthorizedMessage(
      {
        chat: { id: 9001 },
        from: {
          id: 9001,
          first_name: "Client",
          username: "client_user"
        }
      },
      "/start"
    );

    assert.equal(db.listPendingAccessRequests().length, 0);
    assert.equal(
      telegram.calls.filter((call) => call.method === "sendMessage" && call.payload.chat_id === owner.telegram_user_id)
        .length,
      0
    );
    assert.ok(
      telegram.calls.some(
        (call) => call.method === "sendMessage" && call.payload.chat_id === 9001 && call.payload.text.includes("услуга")
      )
    );
    const clientGreeting = telegram.calls.find((call) => call.method === "sendMessage" && call.payload.chat_id === 9001);
    assert.equal(clientGreeting.payload.reply_markup.inline_keyboard[0][0].text, "Написать вопрос");
  } finally {
    cleanup();
  }
});

test("public ask button prompts the client to write a question", async () => {
  const { app, telegram, cleanup } = createTestContext();

  try {
    await app.handleCallbackQuery({
      id: "cb-public-ask",
      from: { id: 9006 },
      data: "public:ask",
      message: {
        message_id: 601,
        chat: { id: 9006 }
      }
    });

    assert.ok(telegram.calls.some((call) => call.method === "answerCallbackQuery"));
    const edited = telegram.calls.find((call) => call.method === "editMessageText");
    assert.ok(edited);
    assert.equal(edited.payload.message_id, 601);
    assert.ok(edited.payload.text.includes("Напишите вопрос"));
  } finally {
    cleanup();
  }
});

test("public Telegram message is stored separately and can become a lead", async () => {
  const { app, db, owner, telegram, cleanup } = createTestContext();

  try {
    await app.handleUnauthorizedMessage(
      {
        chat: { id: 9002 },
        from: {
          id: 9002,
          first_name: "Иван",
          username: "ivan_client"
        }
      },
      "Здравствуйте, нужна химчистка Kia Rio, телефон 89991234567"
    );

    const ownerNotification = telegram.calls.find(
      (call) =>
        call.method === "sendMessage" &&
        call.payload.chat_id === owner.telegram_user_id &&
        call.payload.text.includes("Новое сообщение в Telegram")
    );
    assert.ok(ownerNotification);
    assert.equal(
      telegram.calls.filter((call) => call.method === "sendMessage" && call.payload.chat_id === 9002).length,
      0
    );

    const createButton = ownerNotification.payload.reply_markup.inline_keyboard
      .flat()
      .find((button) => button.callback_data?.startsWith("inbox:create_lead:"));
    assert.ok(createButton);

    await app.handleCallbackQuery({
      id: "cb-inbox-create",
      from: { id: owner.telegram_user_id },
      data: createButton.callback_data,
      message: {
        message_id: 401,
        chat: { id: owner.telegram_user_id }
      }
    });

    const lead = db.findActiveLeadByPhone(normalizePhone("89991234567"));
    assert.ok(lead);
    assert.equal(lead.source_type, SOURCE_TYPE.TELEGRAM);
    assert.equal(lead.source_label, "Telegram bot");
    assert.equal(lead.name, "Иван");
  } finally {
    cleanup();
  }
});

test("owner can manually reply to a Telegram message from its card", async () => {
  const { app, db, owner, telegram, cleanup } = createTestContext();

  try {
    const inboundMessage = db.createInboundMessage({
      telegramUserId: 9007,
      fullName: "Мария",
      username: "maria_client",
      text: "Здравствуйте, можно записаться?"
    });

    await app.handleCallbackQuery({
      id: "cb-inbox-reply",
      from: { id: owner.telegram_user_id },
      data: `inbox:reply:${inboundMessage.id}`,
      message: {
        message_id: 701,
        chat: { id: owner.telegram_user_id }
      }
    });

    assert.equal(app.sessions.get(owner.telegram_user_id)?.type, "inbound_reply");
    telegram.calls.length = 0;

    await app.handleSessionInput(owner, owner.telegram_user_id, "Да, напишите модель авто и удобное время.", app.sessions.get(owner.telegram_user_id));

    const clientReply = telegram.calls.find(
      (call) => call.method === "sendMessage" && call.payload.chat_id === inboundMessage.telegram_user_id
    );
    assert.ok(clientReply);
    assert.equal(clientReply.payload.text, "Да, напишите модель авто и удобное время.");
    assert.equal(db.getInboundMessageById(inboundMessage.id).status, "replied");
    assert.equal(db.countNewInboundMessages(), 0);
    assert.ok(
      telegram.calls.some(
        (call) =>
          call.method === "editMessageText" &&
          call.payload.text.includes("<b>Ответы</b>") &&
          call.payload.text.includes("Да, напишите модель авто")
      )
    );
    const updatedCard = telegram.calls.find((call) => call.method === "editMessageText");
    const updatedButtons = updatedCard.payload.reply_markup.inline_keyboard.flat();
    assert.ok(updatedButtons.some((button) => button.text === "Ответить"));
  } finally {
    cleanup();
  }
});

test("message card shows other messages from the same Telegram client", async () => {
  const { app, db, owner, telegram, cleanup } = createTestContext();

  try {
    db.createInboundMessage({
      telegramUserId: 9008,
      fullName: "Олег",
      username: "oleg_client",
      text: "Первый вопрос по полировке"
    });
    const latestMessage = db.createInboundMessage({
      telegramUserId: 9008,
      fullName: "Олег",
      username: "oleg_client",
      text: "Еще вопрос по химчистке"
    });

    await app.showInboundMessageCard(owner, owner.telegram_user_id, latestMessage, {
      message_id: 801,
      chat: { id: owner.telegram_user_id }
    });

    const card = telegram.calls.find((call) => call.method === "editMessageText");
    assert.ok(card.payload.text.includes("<b>Другие сообщения клиента</b>"));
    assert.ok(card.payload.text.includes("Первый вопрос по полировке"));
  } finally {
    cleanup();
  }
});

test("creating a lead from a message without phone asks for phone with message context", async () => {
  const { app, db, owner, telegram, cleanup } = createTestContext();

  try {
    const inboundMessage = db.createInboundMessage({
      telegramUserId: 9009,
      fullName: "Светлана",
      username: "sveta_client",
      text: "Хочу узнать про керамику кузова"
    });

    await app.handleCallbackQuery({
      id: "cb-inbox-create-no-phone",
      from: { id: owner.telegram_user_id },
      data: `inbox:create_lead:${inboundMessage.id}`,
      message: {
        message_id: 901,
        chat: { id: owner.telegram_user_id }
      }
    });

    const session = app.sessions.get(owner.telegram_user_id);
    assert.equal(session.type, "add_lead");
    assert.equal(session.step, "phone");
    assert.equal(session.draft.inboundMessageId, inboundMessage.id);

    const prompt = telegram.calls.find((call) => call.method === "editMessageText");
    assert.ok(prompt.payload.text.includes("Создаем лид из сообщения Telegram."));
    assert.ok(prompt.payload.text.includes("Хочу узнать про керамику кузова"));
    assert.ok(prompt.payload.text.includes("Введите телефон клиента."));

    telegram.calls.length = 0;
    await app.handleSessionInput(owner, owner.telegram_user_id, "89990002233", app.sessions.get(owner.telegram_user_id));

    assert.equal(app.sessions.get(owner.telegram_user_id).step, "car");
    assert.ok(telegram.calls.some((call) => call.method === "editMessageText" && call.payload.text.includes("Введите авто")));
  } finally {
    cleanup();
  }
});

test("main menu shows new Telegram messages count", async () => {
  const { app, db, owner, telegram, cleanup } = createTestContext();

  try {
    db.createInboundMessage({
      telegramUserId: 9003,
      fullName: "Клиент",
      username: "client",
      text: "Нужна полировка"
    });

    await app.showMainMenu(owner, owner.telegram_user_id);

    const menuMessage = telegram.calls.find((call) => call.method === "sendMessage");
    const labels = menuMessage.payload.reply_markup.keyboard.flat().map((button) => button.text);
    assert.ok(labels.includes("Сообщения (1)"));
  } finally {
    cleanup();
  }
});

test("messages section opens new and all message lists", async () => {
  const { app, db, owner, telegram, cleanup } = createTestContext();

  try {
    const message = db.createInboundMessage({
      telegramUserId: 9004,
      fullName: "Анна",
      username: "anna_client",
      text: "Сколько стоит химчистка?"
    });

    db.ignoreInboundMessage(message.id);
    db.createInboundMessage({
      telegramUserId: 9005,
      fullName: "Петр",
      username: "petr_client",
      text: "Хочу записаться, 89990001122"
    });

    await app.showMessagesOverview(owner, owner.telegram_user_id, {
      message_id: 501,
      chat: { id: owner.telegram_user_id }
    });

    const overview = telegram.calls.find((call) => call.method === "editMessageText");
    assert.ok(overview.payload.text.includes("Новые: <b>1</b>"));
    assert.ok(overview.payload.text.includes("Всего: <b>2</b>"));

    telegram.calls.length = 0;
    await app.handleCallbackQuery({
      id: "cb-messages-all",
      from: { id: owner.telegram_user_id },
      data: "messages:list:all",
      message: {
        message_id: 501,
        chat: { id: owner.telegram_user_id }
      }
    });

    const allList = telegram.calls.find((call) => call.method === "editMessageText");
    assert.ok(allList.payload.text.includes("Все сообщения"));
    assert.ok(allList.payload.text.includes("Сообщений: <b>2</b>"));
  } finally {
    cleanup();
  }
});
