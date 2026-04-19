import {
  ACCESS_REQUEST_STATUS,
  APPOINTMENT_STATUS,
  APPOINTMENT_STATUS_LABELS,
  BLACKLIST_REASON_OPTIONS,
  FILTER_TEMPERATURES,
  FOLLOW_UP_LEAD_STATUSES,
  LEAD_RESULT_LABELS,
  LEAD_STATUS,
  LEAD_STATUS_LABELS,
  LEAD_TEMPERATURE,
  LEAD_TEMPERATURE_LABELS,
  LOST_REASON_OPTIONS,
  MAIN_MENU_LABELS,
  ROLES,
  SOURCE_TYPE
} from "./domain/constants.js";
import { formatPhone, formatWhatsAppPhone, normalizePhone } from "./domain/phone.js";
import { DailySummaryScheduler } from "./services/summary-scheduler.js";
import {
  addLocalDays,
  buildLocalDateTimeFromParts,
  formatFullDateTime,
  formatLeadDate,
  getDayBucketState,
  getLocalDateLabel,
  getLocalDateKey,
  getZonedDateTimeParts,
  parseDailyTime,
  parseStrictDateTime,
  validateTimeZone
} from "./utils/index.js";
import {
  escapeHtml,
  inlineButton,
  inlineKeyboard,
  lines,
  replyButton,
  replyKeyboard
} from "./telegram/index.js";
import { TelegramApiError } from "./telegram/client.js";

function textOrDash(value) {
  return value && String(value).trim() ? String(value).trim() : "—";
}

function truncateText(value, maxLength = 40) {
  const text = String(value ?? "").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function isCommand(text, command) {
  return text === command || text.startsWith(`${command}@`);
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseZeroBasedIndex(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function getTelegramFullName(from) {
  return [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim() || "Без имени";
}

function extractLikelyPhone(text) {
  const matches = String(text ?? "").match(/(?:\+?\d[\d\s().-]{8,}\d)/g) ?? [];

  for (const match of matches) {
    const normalized = normalizePhone(match);
    if (normalized && normalized.length >= 10 && normalized.length <= 15) {
      return {
        phone: formatPhone(match),
        phoneNormalized: normalized
      };
    }
  }

  return {
    phone: null,
    phoneNormalized: null
  };
}

function compactInlineRows(rows) {
  return rows.filter((row) => Array.isArray(row) && row.length > 0);
}

function getSourceMessageId(sourceMessage) {
  const messageId = sourceMessage?.message_id;
  return Number.isInteger(messageId) && messageId > 0 ? messageId : null;
}

function withSourceMessage(session, sourceMessage) {
  const sourceMessageId = getSourceMessageId(sourceMessage);
  return sourceMessageId ? { ...session, sourceMessageId } : session;
}

function getSessionSourceMessage(chatId, session) {
  return session?.sourceMessageId
    ? {
        message_id: session.sourceMessageId,
        chat: { id: chatId }
      }
    : null;
}

function menuLabelWithCount(label, count) {
  return `${label} (${count})`;
}

function getMenuActionFromText(text) {
  const normalized = String(text ?? "").trim();

  if (normalized.startsWith(MAIN_MENU_LABELS.NEW_LEADS)) {
    return "new_leads";
  }

  if (normalized.startsWith(MAIN_MENU_LABELS.IN_WORK)) {
    return "in_work";
  }

  if (normalized.startsWith(MAIN_MENU_LABELS.POSTPONED)) {
    return "postponed";
  }

  if (normalized.startsWith(MAIN_MENU_LABELS.OVERDUE)) {
    return "overdue";
  }

  if (normalized.startsWith(MAIN_MENU_LABELS.TODAY)) {
    return "today";
  }

  if (normalized.startsWith(MAIN_MENU_LABELS.TOMORROW)) {
    return "tomorrow";
  }

  if (normalized === MAIN_MENU_LABELS.ADD_LEAD) {
    return "add_lead";
  }

  if (normalized === MAIN_MENU_LABELS.SEARCH) {
    return "search";
  }

  if (normalized.startsWith(MAIN_MENU_LABELS.MESSAGES)) {
    return "messages";
  }

  if (normalized.startsWith(MAIN_MENU_LABELS.BLACKLIST)) {
    return "blacklist";
  }

  if (normalized.startsWith(`${MAIN_MENU_LABELS.REMINDERS}:`)) {
    return "toggle_reminders";
  }

  if (normalized === MAIN_MENU_LABELS.SETTINGS) {
    return "settings";
  }

  return null;
}

function getLocalDayStart(referenceDate, timeZone, dayOffset = 0) {
  const parts = getZonedDateTimeParts(referenceDate, timeZone);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset));

  return buildLocalDateTimeFromParts(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: 0,
      minute: 0
    },
    timeZone
  );
}

function getRangeContext(timeZone, now = new Date()) {
  const todayStart = getLocalDayStart(now, timeZone, 0);
  const tomorrowStart = getLocalDayStart(now, timeZone, 1);
  const dayAfterTomorrowStart = getLocalDayStart(now, timeZone, 2);

  return {
    now,
    nowIsoValue: now.toISOString(),
    todayStart,
    tomorrowStart,
    dayAfterTomorrowStart,
    todayStartIso: todayStart.toISOString(),
    tomorrowStartIso: tomorrowStart.toISOString(),
    dayAfterTomorrowStartIso: dayAfterTomorrowStart.toISOString()
  };
}

function leadNextContactLabel(lead, timeZone, now = new Date()) {
  if (lead.status === LEAD_STATUS.NEW) {
    return `поступил ${formatLeadDate(new Date(lead.received_at), timeZone)}`;
  }

  if (!lead.next_contact_at) {
    return "без даты контакта";
  }

  const nextDate = new Date(lead.next_contact_at);
  const bucketState = getDayBucketState(nextDate, timeZone, now);

  if (bucketState.isOverdue) {
    return `просрочен ${bucketState.timeLabel}`;
  }

  if (bucketState.isToday) {
    return `сегодня ${bucketState.timeLabel}`;
  }

  if (bucketState.isTomorrow) {
    return `завтра ${bucketState.timeLabel}`;
  }

  return formatLeadDate(nextDate, timeZone);
}

function leadSectionStatusLine(lead, timeZone, now = new Date()) {
  const statusLabel = LEAD_STATUS_LABELS[lead.status] ?? lead.status;
  const temperatureLabel = lead.temperature
    ? LEAD_TEMPERATURE_LABELS[lead.temperature] ?? lead.temperature
    : "—";

  return `${statusLabel} | ${temperatureLabel} | ${leadNextContactLabel(lead, timeZone, now)}`;
}

function formatLeadListLabel(lead, timeZone, now = new Date()) {
  const top = `${truncateText(lead.name, 16)} | ${truncateText(lead.car ?? "—", 10)} | ${truncateText(
    lead.service ?? "—",
    12
  )}`;
  const bottom = leadSectionStatusLine(lead, timeZone, now);

  return `${truncateText(top, 40)} · ${truncateText(bottom, 20)}`;
}

function formatAppointmentListLabel(appointment, timeZone) {
  return truncateText(
    `${appointment.lead_name} | ${formatLeadDate(new Date(appointment.appointment_at), timeZone)} | ${
      appointment.service
    }`,
    64
  );
}

function inboundMessageStatusLabel(status) {
  if (status === "new") {
    return "Новое";
  }

  if (status === "lead_created") {
    return "Лид создан";
  }

  if (status === "replied") {
    return "Ответили";
  }

  if (status === "ignored") {
    return "Игнор";
  }

  return status;
}

function formatInboundMessageListLabel(message, timeZone) {
  return truncateText(
    `${message.full_name} | ${inboundMessageStatusLabel(message.status)} | ${formatLeadDate(
      new Date(message.created_at),
      timeZone
    )} | ${message.text}`,
    64
  );
}

function boolToOnOff(value) {
  return value ? "Вкл" : "Выкл";
}

function buildMainMenuKeyboard(counts, user) {
  return replyKeyboard(
    [
      [
        replyButton(menuLabelWithCount(MAIN_MENU_LABELS.NEW_LEADS, counts.newUnprocessed)),
        replyButton(menuLabelWithCount(MAIN_MENU_LABELS.IN_WORK, counts.inWorkCount))
      ],
      [
        replyButton(menuLabelWithCount(MAIN_MENU_LABELS.POSTPONED, counts.postponed)),
        replyButton(menuLabelWithCount(MAIN_MENU_LABELS.OVERDUE, counts.overdueContacts))
      ],
      [
        replyButton(menuLabelWithCount(MAIN_MENU_LABELS.TODAY, counts.todayContacts + counts.todayAppointments)),
        replyButton(
          menuLabelWithCount(MAIN_MENU_LABELS.TOMORROW, counts.tomorrowContacts + counts.tomorrowAppointments)
        )
      ],
      [replyButton(MAIN_MENU_LABELS.ADD_LEAD), replyButton(MAIN_MENU_LABELS.SEARCH)],
      [
        replyButton(menuLabelWithCount(MAIN_MENU_LABELS.MESSAGES, counts.newInboundMessages)),
        replyButton(menuLabelWithCount(MAIN_MENU_LABELS.BLACKLIST, counts.blacklistCount)),
      ],
      [
        replyButton(`${MAIN_MENU_LABELS.REMINDERS}: ${boolToOnOff(user.summary_enabled)}`)
      ],
      [replyButton(MAIN_MENU_LABELS.SETTINGS)]
    ],
    {
      resize_keyboard: true,
      is_persistent: true,
      input_field_placeholder: "Выберите раздел"
    }
  );
}

function buildTemperatureFilterRow(section, currentFilter = "all") {
  return FILTER_TEMPERATURES.map((item) =>
    inlineButton(
      `${item.value === currentFilter ? "• " : ""}${item.label}`,
      {
        callback_data: `section:view:${section}:${item.value}`
      }
    )
  );
}

export class MiniCrmBotApp {
  constructor({ config, db, telegramClient, sessionStore }) {
    this.config = config;
    this.db = db;
    this.telegram = telegramClient;
    this.sessions = sessionStore;
    this.summaryScheduler = new DailySummaryScheduler({
      onTrigger: async ({ userId }) => {
        const user = this.db.getUserById(Number(userId));
        if (!user || !user.is_active || !user.summary_enabled) {
          return;
        }

        await this.sendDailySummary(user);
      },
      onStateChange: async ({ userId, lastTriggeredLocalDate }) => {
        this.db.markSummarySent(Number(userId), lastTriggeredLocalDate);
      },
      onError: async (error) => {
        console.error("[summary-scheduler]", error);
      }
    });
  }

  async start() {
    const webhookUrl = `${this.config.botPublicUrl}/telegram/webhook/${this.config.botWebhookSecret}`;

    await this.telegram.setWebhook({
      url: webhookUrl,
      secret_token: this.config.botWebhookSecret,
      allowed_updates: ["message", "callback_query"]
    });

    this.syncSummaryUsers();
    this.summaryScheduler.start();
  }

  stop() {
    this.summaryScheduler.stop();
  }

  async sendInlineScreen(chatId, payload, sourceMessage = null) {
    const messagePayload = {
      chat_id: chatId,
      ...payload
    };

    if (!sourceMessage?.message_id) {
      await this.telegram.sendMessage(messagePayload);
      return;
    }

    try {
      await this.telegram.editMessageText({
        chat_id: chatId,
        message_id: sourceMessage.message_id,
        text: payload.text,
        parse_mode: payload.parse_mode,
        reply_markup: payload.reply_markup
      });
    } catch (error) {
      if (
        error instanceof TelegramApiError &&
        typeof error.description === "string" &&
        error.description.includes("message is not modified")
      ) {
        return;
      }

      await this.telegram.sendMessage(messagePayload);
    }
  }

  async sendSessionPrompt(chatId, text, sourceMessage = null, options = {}) {
    const rows = compactInlineRows([
      options.backCallbackData
        ? [inlineButton(options.backText ?? "Назад", { callback_data: options.backCallbackData })]
        : null,
      options.cancel === false ? null : [inlineButton("Отмена", { callback_data: "session:cancel" })]
    ]);

    await this.sendInlineScreen(
      chatId,
      {
        text,
        reply_markup: rows.length ? inlineKeyboard(rows) : undefined
      },
      sourceMessage
    );
  }

  syncSummaryUsers() {
    const users = this.db.listActiveUsers();
    this.summaryScheduler.syncUsers(
      users.map((user) => ({
        userId: user.id,
        summaryEnabled: user.summary_enabled,
        summaryTime: user.summary_time,
        timeZone: user.timezone,
        lastTriggeredLocalDate: user.last_summary_sent_local_date
      }))
    );
  }

  async handleTelegramUpdate(update) {
    try {
      if (update.message) {
        await this.handleMessage(update.message);
        return;
      }

      if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
      }
    } catch (error) {
      console.error("[telegram-update]", error);

      const chatId =
        update.callback_query?.message?.chat?.id ??
        update.message?.chat?.id ??
        update.callback_query?.from?.id;

      if (chatId) {
        await this.telegram.sendMessage({
          chat_id: chatId,
          text: "Не удалось выполнить действие. Попробуйте еще раз."
        });
      }
    }
  }

  async handleSiteLead(payload) {
    const phoneNormalized = normalizePhone(payload.phone);
    if (!phoneNormalized) {
      return {
        success: false,
        action: "validation_error",
        error: "phone is required"
      };
    }

    const blacklistEntry = this.db.getBlacklistByPhone(phoneNormalized);
    if (blacklistEntry) {
      await this.notifyBlacklistHit({
        phone: payload.phone,
        name: payload.name,
        service: payload.service,
        comment: payload.comment,
        blacklistEntry
      });

      return {
        success: true,
        action: "blacklisted"
      };
    }

    const existingLead = this.db.findActiveLeadByPhone(phoneNormalized);
    if (existingLead) {
      this.db.createLeadHistory({
        leadId: existingLead.id,
        eventType: "repeat_incoming",
        eventText: "Повторная заявка с сайта",
        meta: {
          service: payload.service ?? null,
          comment: payload.comment ?? null
        }
      });

      await this.notifyDuplicateLead(existingLead, payload);

      return {
        success: true,
        action: "duplicate_found"
      };
    }

    const lead = this.db.createSiteLead({
      ...payload,
      phoneNormalized
    });

    this.db.createLeadHistory({
      leadId: lead.id,
      eventType: "created",
      eventText: "Лид создан, источник: сайт",
      meta: {
        service: payload.service ?? null,
        comment: payload.comment ?? null
      }
    });

    await this.notifyNewLead(lead);

    return {
      success: true,
      action: "created",
      leadId: lead.id
    };
  }

  async handleMessage(message) {
    const text = String(message.text ?? "").trim();
    const telegramUserId = message.from?.id;
    if (!telegramUserId) {
      return;
    }

    const user = this.db.getUserByTelegramId(telegramUserId);
    const activeUser = user && user.is_active ? user : null;

    if (!activeUser) {
      await this.handleUnauthorizedMessage(message, text);
      return;
    }

    if (text === "/cancel") {
      this.sessions.clear(telegramUserId);
      await this.showMainMenu(activeUser, message.chat.id, "Текущее действие отменено.");
      return;
    }

    const session = this.sessions.get(telegramUserId);
    if (session) {
      await this.handleSessionInput(activeUser, message.chat.id, text, session);
      return;
    }

    if (isCommand(text, "/start") || isCommand(text, "/menu")) {
      await this.showMainMenu(activeUser, message.chat.id, "Главное меню");
      return;
    }

    if (isCommand(text, "/settings")) {
      await this.showSettings(activeUser, message.chat.id);
      return;
    }

    const action = getMenuActionFromText(text);
    if (!action) {
      await this.showMainMenu(activeUser, message.chat.id, "Не понял команду. Выберите раздел ниже.");
      return;
    }

    switch (action) {
      case "new_leads":
        await this.showLeadSection(activeUser, message.chat.id, "new");
        break;
      case "in_work":
        await this.showLeadSection(activeUser, message.chat.id, "in_work");
        break;
      case "postponed":
        await this.showLeadSection(activeUser, message.chat.id, "postponed");
        break;
      case "overdue":
        await this.showLeadSection(activeUser, message.chat.id, "overdue");
        break;
      case "today":
        await this.showDayOverview(activeUser, message.chat.id, "today");
        break;
      case "tomorrow":
        await this.showDayOverview(activeUser, message.chat.id, "tomorrow");
        break;
      case "add_lead":
        this.sessions.set(telegramUserId, {
          type: "add_lead",
          step: "phone",
          draft: {}
        });
        await this.telegram.sendMessage({
          chat_id: message.chat.id,
          text: "Введите телефон клиента в любом удобном формате.",
          reply_markup: buildMainMenuKeyboard(await this.getMainMenuCounts(activeUser), activeUser)
        });
        break;
      case "search":
        this.sessions.set(telegramUserId, {
          type: "search",
          step: "query"
        });
        await this.telegram.sendMessage({
          chat_id: message.chat.id,
          text: "Введите телефон, имя, услугу, комментарий или авто."
        });
        break;
      case "messages":
        await this.showMessagesOverview(activeUser, message.chat.id);
        break;
      case "blacklist":
        await this.showBlacklistSection(activeUser, message.chat.id);
        break;
      case "toggle_reminders":
        await this.toggleUserSummary(activeUser, message.chat.id);
        break;
      case "settings":
        await this.showSettings(activeUser, message.chat.id);
        break;
      default:
        await this.showMainMenu(activeUser, message.chat.id, "Раздел пока не поддерживается.");
        break;
    }
  }

  async handleUnauthorizedMessage(message, text) {
    if (isCommand(text, "/access")) {
      const response = this.db.createOrRefreshAccessRequest({
        telegramUserId: message.from.id,
        fullName: getTelegramFullName(message.from),
        username: message.from.username ?? null
      });

      if (response.type === "already_active") {
        await this.showMainMenu(response.user, message.chat.id, "Главное меню");
        return;
      }

      if (response.type === "pending_created") {
        await this.notifyOwnerAboutAccessRequest(response.request);
      }

      const requestMessage =
        response.type === "pending_existing"
          ? "Запрос на доступ уже отправлен. Ожидайте подтверждения."
          : "Запрос доступа отправлен владельцу. Ожидайте подтверждения.";

      await this.telegram.sendMessage({
        chat_id: message.chat.id,
        text: requestMessage
      });
      return;
    }

    await this.handlePublicClientMessage(message, text);
  }

  async handlePublicClientMessage(message, text) {
    if (isCommand(text, "/start")) {
      await this.telegram.sendMessage({
        chat_id: message.chat.id,
        text: lines(
          "Здравствуйте! Здесь можно задать вопрос по услугам детейлинга.",
          "Нажмите кнопку ниже и напишите, что нужно. Если удобно, сразу добавьте авто и телефон."
        ),
        reply_markup: inlineKeyboard([[inlineButton("Написать вопрос", { callback_data: "public:ask" })]])
      });
      return;
    }

    if (!text) {
      await this.telegram.sendMessage({
        chat_id: message.chat.id,
        text: "Напишите, пожалуйста, текстом услугу, авто и телефон для связи."
      });
      return;
    }

    const phone = extractLikelyPhone(text);
    const inboundMessage = this.db.createInboundMessage({
      telegramUserId: message.from.id,
      fullName: getTelegramFullName(message.from),
      username: message.from.username ?? null,
      text,
      phone: phone.phone,
      phoneNormalized: phone.phoneNormalized
    });

    await this.notifyIncomingTelegramMessage(inboundMessage);
  }

  async handleCallbackQuery(callbackQuery) {
    const data = callbackQuery.data ?? "";
    const user = this.db.getUserByTelegramId(callbackQuery.from.id);
    const activeUser = user && user.is_active ? user : null;

    if (!activeUser && !data.startsWith("access:") && !data.startsWith("public:")) {
      await this.telegram.answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: "Нет доступа к боту"
      });
      return;
    }

    if (data.startsWith("public:")) {
      await this.handlePublicCallback(callbackQuery);
      return;
    }

    if (data.startsWith("access:")) {
      await this.handleAccessCallback(callbackQuery, activeUser);
      return;
    }

    const parts = data.split(":");
    const [entity, action, ...rest] = parts;
    const activeSession = this.sessions.get(callbackQuery.from.id);

    if (
      entity !== "session" &&
      !(entity === "blacklist" && action === "reason") &&
      activeSession?.sourceMessageId &&
      activeSession.sourceMessageId === callbackQuery.message?.message_id
    ) {
      this.sessions.clear(callbackQuery.from.id);
    }

    if (entity === "nav" && action === "main") {
      this.sessions.clear(callbackQuery.from.id);
      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      await this.showMainMenu(activeUser, callbackQuery.message.chat.id, "Главное меню");
      return;
    }

    if (entity === "section" && action === "view") {
      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      await this.showLeadSection(
        activeUser,
        callbackQuery.message.chat.id,
        rest[0],
        rest[1] ?? "all",
        callbackQuery.message
      );
      return;
    }

    if (entity === "day" && action === "view") {
      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      if (rest[1] === "overview") {
        await this.showDayOverview(activeUser, callbackQuery.message.chat.id, rest[0], callbackQuery.message);
        return;
      }
      await this.showDayDetail(activeUser, callbackQuery.message.chat.id, rest[0], rest[1], callbackQuery.message);
      return;
    }

    if (entity === "lead") {
      await this.handleLeadCallback(callbackQuery, activeUser, action, rest);
      return;
    }

    if (entity === "appt") {
      await this.handleAppointmentCallback(callbackQuery, activeUser, action, rest);
      return;
    }

    if (entity === "settings") {
      await this.handleSettingsCallback(callbackQuery, activeUser, action, rest);
      return;
    }

    if (entity === "employees") {
      await this.handleEmployeesCallback(callbackQuery, activeUser, action, rest);
      return;
    }

    if (entity === "blacklist") {
      await this.handleBlacklistCallback(callbackQuery, activeUser, action, rest);
      return;
    }

    if (entity === "inbox") {
      await this.handleInboxCallback(callbackQuery, activeUser, action, rest);
      return;
    }

    if (entity === "messages") {
      await this.handleMessagesCallback(callbackQuery, activeUser, action, rest);
      return;
    }

    if (entity === "session") {
      await this.handleSessionCallback(callbackQuery, activeUser, action, rest);
      return;
    }

    if (entity === "search") {
      await this.handleSearchCallback(callbackQuery, activeUser, action, rest);
      return;
    }

    await this.telegram.answerCallbackQuery({
      callback_query_id: callbackQuery.id,
      text: "Неизвестное действие"
    });
  }

  async handleAccessCallback(callbackQuery, activeUser) {
    const parts = (callbackQuery.data ?? "").split(":");
    const [, action, requestIdRaw] = parts;

    if (action === "request") {
      const response = this.db.createOrRefreshAccessRequest({
        telegramUserId: callbackQuery.from.id,
        fullName:
          [callbackQuery.from.first_name, callbackQuery.from.last_name].filter(Boolean).join(" ").trim() ||
          "Без имени",
        username: callbackQuery.from.username ?? null
      });

      if (response.type === "pending_created") {
        await this.notifyOwnerAboutAccessRequest(response.request);
      }

      await this.telegram.answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: "Запрос отправлен"
      });
      return;
    }

    if (!activeUser || activeUser.role !== ROLES.OWNER) {
      await this.telegram.answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: "Только владелец может управлять доступом"
      });
      return;
    }

    const requestId = parsePositiveInteger(requestIdRaw);
    if (!requestId) {
      await this.telegram.answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: "Некорректный запрос"
      });
      return;
    }

    if (action === "approve") {
      const approvedUser = this.db.approveAccessRequest(requestId, activeUser.id);
      this.syncSummaryUsers();

      if (approvedUser) {
        await this.telegram.sendMessage({
          chat_id: approvedUser.telegram_user_id,
          text: "Доступ к боту открыт."
        });
      }

      await this.telegram.answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: "Доступ выдан"
      });
      await this.showEmployees(activeUser, callbackQuery.message.chat.id, callbackQuery.message);
      return;
    }

    if (action === "reject") {
      const request = this.db.rejectAccessRequest(requestId, activeUser.id);
      if (request) {
        await this.telegram.sendMessage({
          chat_id: request.telegram_user_id,
          text: "Запрос на доступ отклонен."
        });
      }

      await this.telegram.answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: "Запрос отклонен"
      });
      await this.showEmployees(activeUser, callbackQuery.message.chat.id, callbackQuery.message);
      return;
    }
  }

  async handlePublicCallback(callbackQuery) {
    const [, action] = (callbackQuery.data ?? "").split(":");

    if (action === "ask") {
      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      await this.sendInlineScreen(
        callbackQuery.message.chat.id,
        {
          text: "Напишите вопрос одним сообщением. Если удобно, сразу добавьте авто и телефон для связи."
        },
        callbackQuery.message
      );
      return;
    }

    await this.telegram.answerCallbackQuery({
      callback_query_id: callbackQuery.id,
      text: "Неизвестное действие"
    });
  }

  async handleLeadCallback(callbackQuery, user, action, rest) {
    const leadId = parsePositiveInteger(rest[0]);
    const lead = leadId ? this.db.getLeadById(leadId) : null;

    if (action !== "create_from_blacklist" && action !== "create_continue" && !lead) {
      await this.telegram.answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: "Лид не найден"
      });
      return;
    }

    switch (action) {
      case "create_from_blacklist":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.handleCreateLeadFromBlacklist(user, callbackQuery.message.chat.id, rest[0], callbackQuery.message);
        break;
      case "view":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.showLeadCard(user, callbackQuery.message.chat.id, lead, callbackQuery.message);
        break;
      case "result_menu":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.sendLeadResultMenu(callbackQuery.message.chat.id, lead, callbackQuery.message);
        break;
      case "result":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.handleLeadResultSelection(user, callbackQuery.message.chat.id, lead, rest[1], callbackQuery.message);
        break;
      case "lost_reason":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.startLeadLostFlow(user, callbackQuery.message.chat.id, lead, rest[1], callbackQuery.message);
        break;
      case "temp_menu":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.sendLeadTemperatureMenu(callbackQuery.message.chat.id, lead, callbackQuery.message);
        break;
      case "temp":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.setLeadTemperature(user, callbackQuery.message.chat.id, lead, rest[1] ?? null, callbackQuery.message);
        break;
      case "comment":
        this.sessions.set(
          user.telegram_user_id,
          withSourceMessage(
            {
              type: "lead_comment",
              leadId: lead.id
            },
            callbackQuery.message
          )
        );
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.sendSessionPrompt(callbackQuery.message.chat.id, "Введите новый комментарий для лида.", callbackQuery.message, {
          backCallbackData: `lead:view:${lead.id}`,
          backText: "Назад к лиду"
        });
        break;
      case "history":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.showLeadHistory(callbackQuery.message.chat.id, lead, user.timezone, callbackQuery.message);
        break;
      case "client_history":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.showClientHistory(
          callbackQuery.message.chat.id,
          lead.phone_normalized,
          user.timezone,
          callbackQuery.message,
          `lead:view:${lead.id}`
        );
        break;
      case "create_appointment":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.startAppointmentFlow(user, callbackQuery.message.chat.id, lead.id, callbackQuery.message);
        break;
      case "edit_menu":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.showLeadEditMenu(callbackQuery.message.chat.id, lead, callbackQuery.message);
        break;
      case "edit":
        this.sessions.set(
          user.telegram_user_id,
          withSourceMessage(
            {
              type: "lead_edit_field",
              leadId: lead.id,
              field: rest[1]
            },
            callbackQuery.message
          )
        );
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.sendSessionPrompt(callbackQuery.message.chat.id, this.getLeadEditPrompt(rest[1]), callbackQuery.message, {
          backCallbackData: `lead:view:${lead.id}`,
          backText: "Назад к лиду"
        });
        break;
      case "contact":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.showLeadContactMenu(callbackQuery.message.chat.id, lead, callbackQuery.message);
        break;
      case "blacklist_menu":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.showLeadBlacklistMenu(callbackQuery.message.chat.id, lead, callbackQuery.message);
        break;
      case "blacklist_reason":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.blacklistLeadByReason(user, callbackQuery.message.chat.id, lead, rest[1], callbackQuery.message);
        break;
      case "delete_confirm":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.showLeadDeleteConfirmation(callbackQuery.message.chat.id, lead, callbackQuery.message);
        break;
      case "delete":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.deleteLead(user, callbackQuery.message.chat.id, lead);
        break;
      case "restore":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.restoreLostLead(user, callbackQuery.message.chat.id, lead, callbackQuery.message);
        break;
      case "open_existing":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.showLeadCard(user, callbackQuery.message.chat.id, lead, callbackQuery.message);
        break;
      default:
        await this.telegram.answerCallbackQuery({
          callback_query_id: callbackQuery.id,
          text: "Действие по лиду пока не поддерживается"
        });
        break;
    }
  }

  async handleAppointmentCallback(callbackQuery, user, action, rest) {
    const appointmentId = parsePositiveInteger(rest[0]);
    const appointment = appointmentId ? this.db.getAppointmentById(appointmentId) : null;

    if (!appointment) {
      await this.telegram.answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: "Запись не найдена"
      });
      return;
    }

    switch (action) {
      case "view":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.showAppointmentCard(user, callbackQuery.message.chat.id, appointment, callbackQuery.message);
        break;
      case "status_menu":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.showAppointmentStatusMenu(callbackQuery.message.chat.id, appointment, callbackQuery.message);
        break;
      case "status":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.setAppointmentStatus(user, callbackQuery.message.chat.id, appointment, rest[1], callbackQuery.message);
        break;
      case "reschedule":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        this.sessions.set(
          user.telegram_user_id,
          withSourceMessage(
            {
              type: "appointment_reschedule",
              appointmentId: appointment.id,
              step: "date"
            },
            callbackQuery.message
          )
        );
        await this.sendSessionPrompt(
          callbackQuery.message.chat.id,
          "Введите новую дату и время в формате ДД.ММ.ГГГГ ЧЧ:ММ",
          callbackQuery.message,
          {
            backCallbackData: `appt:view:${appointment.id}`,
            backText: "Назад к записи"
          }
        );
        break;
      case "comment":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        this.sessions.set(
          user.telegram_user_id,
          withSourceMessage(
            {
              type: "appointment_comment",
              appointmentId: appointment.id
            },
            callbackQuery.message
          )
        );
        await this.sendSessionPrompt(callbackQuery.message.chat.id, "Введите комментарий для записи.", callbackQuery.message, {
          backCallbackData: `appt:view:${appointment.id}`,
          backText: "Назад к записи"
        });
        break;
      case "lead":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.showLeadCard(
          user,
          callbackQuery.message.chat.id,
          this.db.getLeadById(appointment.lead_id),
          callbackQuery.message
        );
        break;
      case "client_history":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.showClientHistory(
          callbackQuery.message.chat.id,
          appointment.phone_normalized,
          user.timezone,
          callbackQuery.message,
          `appt:view:${appointment.id}`
        );
        break;
      case "history":
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.showAppointmentHistory(
          callbackQuery.message.chat.id,
          appointment,
          user.timezone,
          callbackQuery.message
        );
        break;
      default:
        await this.telegram.answerCallbackQuery({
          callback_query_id: callbackQuery.id,
          text: "Неизвестное действие"
        });
        break;
    }
  }

  async handleSettingsCallback(callbackQuery, user, action) {
    if (action === "show") {
      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      await this.showSettings(user, callbackQuery.message.chat.id, callbackQuery.message);
      return;
    }

    if (action === "toggle_summary") {
      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      await this.toggleUserSummary(user, callbackQuery.message.chat.id, callbackQuery.message);
      return;
    }

    if (action === "set_time") {
      this.sessions.set(
        user.telegram_user_id,
        withSourceMessage(
          {
            type: "settings_summary_time"
          },
          callbackQuery.message
        )
      );
      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      await this.sendSessionPrompt(
        callbackQuery.message.chat.id,
        "Введите новое время ежедневной сводки в формате ЧЧ:ММ",
        callbackQuery.message,
        {
          backCallbackData: "settings:show",
          backText: "Назад к настройкам"
        }
      );
      return;
    }

    if (action === "set_timezone") {
      this.sessions.set(
        user.telegram_user_id,
        withSourceMessage(
          {
            type: "settings_timezone"
          },
          callbackQuery.message
        )
      );
      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      await this.sendSessionPrompt(
        callbackQuery.message.chat.id,
        "Введите IANA timezone, например: Europe/Moscow",
        callbackQuery.message,
        {
          backCallbackData: "settings:show",
          backText: "Назад к настройкам"
        }
      );
      return;
    }

    if (action === "employees") {
      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      await this.showEmployees(user, callbackQuery.message.chat.id, callbackQuery.message);
      return;
    }
  }

  async handleEmployeesCallback(callbackQuery, user, action, rest) {
    if (user.role !== ROLES.OWNER) {
      await this.telegram.answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: "Только владелец"
      });
      return;
    }

    if (action === "show") {
      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      await this.showEmployees(user, callbackQuery.message.chat.id, callbackQuery.message);
      return;
    }

    if (action === "revoke") {
      const userId = parsePositiveInteger(rest[0]);
      if (!userId) {
        await this.telegram.answerCallbackQuery({
          callback_query_id: callbackQuery.id,
          text: "Некорректный сотрудник"
        });
        return;
      }

      const revoked = this.db.revokeUserAccess(userId);
      this.syncSummaryUsers();
      if (revoked) {
        await this.telegram.sendMessage({
          chat_id: revoked.telegram_user_id,
          text: "Ваш доступ к боту отключен."
        });
      }

      await this.telegram.answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: "Доступ отключен"
      });
      await this.showEmployees(user, callbackQuery.message.chat.id, callbackQuery.message);
    }
  }

  async handleBlacklistCallback(callbackQuery, user, action, rest) {
    if (action === "show") {
      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      await this.showBlacklistSection(user, callbackQuery.message.chat.id, callbackQuery.message);
      return;
    }

    if (action === "view") {
      const normalized = rest[0];
      const entry = normalized ? this.db.getBlacklistByPhone(normalized) : null;
      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      if (!entry) {
        await this.telegram.sendMessage({
          chat_id: callbackQuery.message.chat.id,
          text: "Запись ЧС не найдена."
        });
        return;
      }

      await this.showBlacklistCard(callbackQuery.message.chat.id, entry, callbackQuery.message);
      return;
    }

    if (action === "remove") {
      const normalized = rest[0];
      if (normalized) {
        this.db.removeBlacklist(normalized, user.id);
      }

      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      await this.showBlacklistSection(user, callbackQuery.message.chat.id, callbackQuery.message);
      return;
    }

    if (action === "add") {
      this.sessions.set(
        user.telegram_user_id,
        withSourceMessage(
          {
            type: "blacklist_add",
            step: "phone",
            draft: {}
          },
          callbackQuery.message
        )
      );
      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      await this.sendSessionPrompt(
        callbackQuery.message.chat.id,
        "Введите номер для добавления в черный список.",
        callbackQuery.message,
        {
          backCallbackData: "blacklist:show",
          backText: "Назад к ЧС"
        }
      );
      return;
    }

    if (action === "reason") {
      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      await this.handleBlacklistAddReason(user, callbackQuery.message.chat.id, rest[0]);
    }
  }

  async handleInboxCallback(callbackQuery, user, action, rest) {
    const inboundId = parsePositiveInteger(rest[0]);
    const inboundMessage = inboundId ? this.db.getInboundMessageById(inboundId) : null;

    if (!inboundMessage) {
      await this.telegram.answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: "Сообщение не найдено"
      });
      return;
    }

    if (action === "ignore") {
      this.db.ignoreInboundMessage(inboundMessage.id);
      await this.telegram.answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: "Сообщение скрыто"
      });
      await this.sendInlineScreen(
        callbackQuery.message.chat.id,
        {
          text: "Сообщение из Telegram отмечено как обработанное."
        },
        callbackQuery.message
      );
      return;
    }

    if (action === "create_lead") {
      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      await this.createLeadFromInboundMessage(user, callbackQuery.message.chat.id, inboundMessage, callbackQuery.message);
      return;
    }

    if (action === "reply") {
      this.sessions.set(
        user.telegram_user_id,
        withSourceMessage(
          {
            type: "inbound_reply",
            inboundMessageId: inboundMessage.id
          },
          callbackQuery.message
        )
      );
      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      await this.sendSessionPrompt(
        callbackQuery.message.chat.id,
        "Введите ответ клиенту. Сообщение будет отправлено сразу после ввода.",
        callbackQuery.message,
        {
          backCallbackData: `messages:open:${inboundMessage.id}`,
          backText: "Назад к сообщению"
        }
      );
      return;
    }

    await this.telegram.answerCallbackQuery({
      callback_query_id: callbackQuery.id,
      text: "Неизвестное действие"
    });
  }

  async handleMessagesCallback(callbackQuery, user, action, rest) {
    await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });

    if (action === "overview") {
      await this.showMessagesOverview(user, callbackQuery.message.chat.id, callbackQuery.message);
      return;
    }

    if (action === "list") {
      await this.showMessagesList(user, callbackQuery.message.chat.id, rest[0] ?? "new", callbackQuery.message);
      return;
    }

    if (action === "open") {
      const messageId = parsePositiveInteger(rest[0]);
      const inboundMessage = messageId ? this.db.getInboundMessageById(messageId) : null;

      if (!inboundMessage) {
        await this.sendInlineScreen(
          callbackQuery.message.chat.id,
          { text: "Сообщение не найдено." },
          callbackQuery.message
        );
        return;
      }

      await this.showInboundMessageCard(user, callbackQuery.message.chat.id, inboundMessage, callbackQuery.message);
    }
  }

  async handleSessionCallback(callbackQuery, user, action, rest) {
    const session = this.sessions.get(user.telegram_user_id);

    if (!session) {
      await this.telegram.answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: "Сценарий уже завершен"
      });
      return;
    }

    if (action === "duplicate_open") {
      const leadId = parsePositiveInteger(rest[0]);
      const lead = leadId ? this.db.getLeadById(leadId) : null;
      this.sessions.clear(user.telegram_user_id);
      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      if (lead) {
        await this.showLeadCard(user, callbackQuery.message.chat.id, lead, callbackQuery.message);
      }
      return;
    }

    if (action === "history_client") {
      const phoneNormalized = rest[0];
      if (!phoneNormalized) {
        await this.telegram.answerCallbackQuery({
          callback_query_id: callbackQuery.id,
          text: "История клиента недоступна"
        });
        return;
      }

      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      await this.showClientHistory(
        callbackQuery.message.chat.id,
        phoneNormalized,
        user.timezone,
        callbackQuery.message
      );
      return;
    }

    if (action === "duplicate_create") {
      if (session.type === "add_lead_duplicate" || session.type === "add_lead_historical") {
        this.sessions.set(
          user.telegram_user_id,
          withSourceMessage(
            {
              type: "add_lead",
              step: "name",
              draft: session.draft
            },
            callbackQuery.message
          )
        );
        await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
        await this.sendSessionPrompt(
          callbackQuery.message.chat.id,
          "Введите имя клиента или свою пометку.",
          callbackQuery.message,
          {
            backCallbackData: "nav:main",
            backText: "В меню"
          }
        );
      }
      return;
    }

    if (action === "cancel") {
      this.sessions.clear(user.telegram_user_id);
      await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
      await this.showMainMenu(user, callbackQuery.message.chat.id, "Действие отменено.");
    }
  }

  async handleSessionInput(user, chatId, text, session) {
    switch (session.type) {
      case "search":
        await this.handleSearchSession(user, chatId, text);
        break;
      case "search_results":
        await this.handleSearchSession(user, chatId, text);
        break;
      case "add_lead":
        await this.handleAddLeadSession(user, chatId, text, session);
        break;
      case "lead_comment":
        await this.handleLeadCommentSession(user, chatId, text, session);
        break;
      case "lead_followup":
        await this.handleLeadFollowupSession(user, chatId, text, session);
        break;
      case "lead_lost_comment":
        await this.handleLeadLostCommentSession(user, chatId, text, session);
        break;
      case "lead_edit_field":
        await this.handleLeadEditSession(user, chatId, text, session);
        break;
      case "appointment_create":
        await this.handleAppointmentCreateSession(user, chatId, text, session);
        break;
      case "appointment_reschedule":
        await this.handleAppointmentRescheduleSession(user, chatId, text, session);
        break;
      case "appointment_comment":
        await this.handleAppointmentCommentSession(user, chatId, text, session);
        break;
      case "settings_summary_time":
        await this.handleSummaryTimeSession(user, chatId, text);
        break;
      case "settings_timezone":
        await this.handleTimezoneSession(user, chatId, text);
        break;
      case "blacklist_add":
        await this.handleBlacklistAddSession(user, chatId, text, session);
        break;
      case "lead_blacklist_comment":
        await this.handleLeadBlacklistCommentSession(user, chatId, text, session);
        break;
      case "inbound_reply":
        await this.handleInboundReplySession(user, chatId, text, session);
        break;
      default:
        this.sessions.clear(user.telegram_user_id);
        await this.showMainMenu(user, chatId, "Сессия сброшена.");
        break;
    }
  }

  async handleSearchSession(user, chatId, text) {
    this.sessions.set(user.telegram_user_id, {
      type: "search_results",
      query: text,
      filter: "all"
    });

    await this.renderSearchResults(user, chatId, text, "all");
  }

  async handleInboundReplySession(user, chatId, text, session) {
    const inboundMessage = this.db.getInboundMessageById(session.inboundMessageId);
    const sourceMessage = getSessionSourceMessage(chatId, session);

    if (!inboundMessage) {
      this.sessions.clear(user.telegram_user_id);
      await this.sendInlineScreen(chatId, { text: "Сообщение не найдено." }, sourceMessage);
      return;
    }

    if (!text) {
      await this.sendSessionPrompt(
        chatId,
        "Ответ не должен быть пустым. Введите текст ответа клиенту.",
        sourceMessage,
        {
          backCallbackData: `messages:open:${inboundMessage.id}`,
          backText: "Назад к сообщению"
        }
      );
      return;
    }

    await this.telegram.sendMessage({
      chat_id: inboundMessage.telegram_user_id,
      text
    });

    this.db.createInboundMessageReply({
      inboundMessageId: inboundMessage.id,
      actorUserId: user.id,
      text
    });

    const updatedMessage = this.db.markInboundMessageReplied(inboundMessage.id);
    this.sessions.clear(user.telegram_user_id);
    await this.showInboundMessageCard(user, chatId, updatedMessage, sourceMessage);
  }

  async handleSearchCallback(callbackQuery, user, action, rest) {
    if (action !== "filter") {
      await this.telegram.answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: "Неизвестное действие поиска"
      });
      return;
    }

    const session = this.sessions.get(user.telegram_user_id);
    if (!session || session.type !== "search_results") {
      await this.telegram.answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: "Поиск уже завершен. Запустите новый."
      });
      return;
    }

    const filter = rest[0] ?? "all";
    this.sessions.set(user.telegram_user_id, {
      ...session,
      filter
    });

    await this.telegram.answerCallbackQuery({ callback_query_id: callbackQuery.id });
    await this.renderSearchResults(user, callbackQuery.message.chat.id, session.query, filter, callbackQuery.message);
  }

  async renderSearchResults(user, chatId, query, filter, sourceMessage = null) {
    const normalizedFilter = ["all", "active", "lost", "blacklist"].includes(filter) ? filter : "all";
    const results = normalizedFilter === "blacklist" ? [] : this.db.searchLeads(query, normalizedFilter);
    const blacklistMatches =
      normalizedFilter === "blacklist" || normalizedFilter === "all"
        ? this.db
            .listBlacklist()
            .filter((item) =>
              [item.phone, item.name_label, item.comment, item.reason]
                .filter(Boolean)
                .some((value) => value.toLowerCase().includes(query.toLowerCase()))
            )
        : [];

    const leadLines = results.slice(0, 10).map((lead) => {
      return `${escapeHtml(lead.name)} | ${escapeHtml(textOrDash(lead.service))} | ${escapeHtml(
        LEAD_STATUS_LABELS[lead.status] ?? lead.status
      )}`;
    });

    const blacklistLines = blacklistMatches.slice(0, 5).map((entry) => {
      return `${escapeHtml(textOrDash(entry.name_label))} | ${escapeHtml(formatPhone(entry.phone))} | ${escapeHtml(
        entry.reason
      )}`;
    });

    const rows = compactInlineRows([
      [
        inlineButton(`${normalizedFilter === "all" ? "• " : ""}Все`, {
          callback_data: "search:filter:all"
        }),
        inlineButton(`${normalizedFilter === "active" ? "• " : ""}Активные`, {
          callback_data: "search:filter:active"
        })
      ],
      [
        inlineButton(`${normalizedFilter === "lost" ? "• " : ""}Потерянные`, {
          callback_data: "search:filter:lost"
        }),
        inlineButton(`${normalizedFilter === "blacklist" ? "• " : ""}Черный список`, {
          callback_data: "search:filter:blacklist"
        })
      ],
      ...results.slice(0, 10).map((lead) => [
        inlineButton(formatLeadListLabel(lead, user.timezone), {
          callback_data: `lead:view:${lead.id}`
        })
      ]),
      ...blacklistMatches.slice(0, 5).map((entry) => [
        inlineButton(`${truncateText(textOrDash(entry.name_label), 18)} | ${formatPhone(entry.phone)}`, {
          callback_data: `blacklist:view:${entry.phone_normalized}`
        })
      ]),
      [inlineButton("В меню", { callback_data: "nav:main" })]
    ]);

    await this.sendInlineScreen(chatId, {
      parse_mode: "HTML",
      text: lines(
        `<b>Результаты поиска</b>`,
        `Запрос: <code>${escapeHtml(query)}</code>`,
        leadLines.length ? "" : normalizedFilter === "blacklist" ? undefined : "Совпадений по лидам нет.",
        ...leadLines,
        blacklistLines.length ? "" : normalizedFilter === "blacklist" ? "Совпадений в ЧС нет." : undefined,
        blacklistLines.length ? "<b>Черный список</b>" : undefined,
        ...blacklistLines
      ),
      reply_markup: inlineKeyboard(rows)
    }, sourceMessage);
  }

  async handleAddLeadSession(user, chatId, text, session) {
    const sourceMessage = getSessionSourceMessage(chatId, session);

    if (session.step === "phone") {
      const phoneNormalized = normalizePhone(text);
      if (!phoneNormalized) {
        await this.sendSessionPrompt(chatId, "Не удалось распознать номер. Введите телефон еще раз.", sourceMessage);
        return;
      }

      const blacklistEntry = this.db.getBlacklistByPhone(phoneNormalized);
      if (blacklistEntry) {
        this.sessions.clear(user.telegram_user_id);
        await this.sendInlineScreen(chatId, {
          text: lines(
            "Номер находится в черном списке.",
            `Телефон: ${formatPhone(text)}`,
            `Причина: ${blacklistEntry.reason}`
          ),
          reply_markup: inlineKeyboard([
            [
              inlineButton("Открыть ЧС", {
                callback_data: `blacklist:view:${phoneNormalized}`
              }),
              inlineButton("Убрать из ЧС и создать лид", {
                callback_data: `lead:create_from_blacklist:${phoneNormalized}`
              })
            ],
            [inlineButton("Отмена", { callback_data: "session:cancel" })]
          ])
        }, sourceMessage);
        return;
      }

      const activeLead = this.db.findActiveLeadByPhone(phoneNormalized);
      if (activeLead) {
        this.sessions.set(user.telegram_user_id, {
          type: "add_lead_duplicate",
          existingLeadId: activeLead.id,
          draft: {
            ...session.draft,
            phone: formatPhone(text),
            phoneNormalized
          }
        });

        await this.sendInlineScreen(chatId, {
          text: lines(
            "Такой лид уже существует.",
            `Имя: ${activeLead.name}`,
            `Телефон: ${formatPhone(activeLead.phone)}`,
            `Статус: ${LEAD_STATUS_LABELS[activeLead.status] ?? activeLead.status}`
          ),
          reply_markup: inlineKeyboard([
            [
              inlineButton("Открыть существующий", {
                callback_data: `session:duplicate_open:${activeLead.id}`
              }),
              inlineButton("Создать новое обращение", {
                callback_data: "session:duplicate_create"
              })
            ],
            [inlineButton("Отмена", { callback_data: "session:cancel" })]
          ])
        }, sourceMessage);
        return;
      }

      const historicalLeads = this.db.listHistoricalLeadsByPhone(phoneNormalized).filter((lead) => lead.deleted_at === null);
      if (historicalLeads.length > 0) {
        this.sessions.set(user.telegram_user_id, {
          type: "add_lead_historical",
          draft: {
            ...session.draft,
            phone: formatPhone(text),
            phoneNormalized
          }
        });

        await this.sendInlineScreen(chatId, {
          text: lines(
            "Это повторный клиент.",
            `Телефон: ${formatPhone(text)}`,
            "Можно посмотреть историю или создать новое обращение."
          ),
          reply_markup: inlineKeyboard([
            [
              inlineButton("Посмотреть историю клиента", {
                callback_data: `session:history_client:${phoneNormalized}`
              }),
              inlineButton("Создать новое обращение", {
                callback_data: "session:duplicate_create"
              })
            ],
            [inlineButton("Отмена", { callback_data: "session:cancel" })]
          ])
        }, sourceMessage);
        return;
      }

      if (session.draft.name) {
        this.sessions.set(user.telegram_user_id, {
          type: "add_lead",
          step: "car",
          draft: {
            ...session.draft,
            phone: formatPhone(text),
            phoneNormalized
          },
          sourceMessageId: session.sourceMessageId
        });

        await this.sendSessionPrompt(chatId, "Введите авто или `-`, если пока пусто.", sourceMessage);
        return;
      }

      this.sessions.set(user.telegram_user_id, {
        type: "add_lead",
        step: "name",
        draft: {
          ...session.draft,
          phone: formatPhone(text),
          phoneNormalized
        },
        sourceMessageId: session.sourceMessageId
      });

      await this.sendSessionPrompt(chatId, "Введите имя клиента или свою пометку.", sourceMessage);
      return;
    }

    if (session.step === "name") {
      this.sessions.set(user.telegram_user_id, {
        type: "add_lead",
        step: "car",
        draft: {
          ...session.draft,
          name: text || "Без имени"
        },
        sourceMessageId: session.sourceMessageId
      });

      await this.sendSessionPrompt(chatId, "Введите авто или `-`, если пока пусто.", sourceMessage);
      return;
    }

    if (session.step === "car") {
      this.sessions.set(user.telegram_user_id, {
        type: "add_lead",
        step: "service",
        draft: {
          ...session.draft,
          car: text === "-" ? null : text
        },
        sourceMessageId: session.sourceMessageId
      });

      await this.sendSessionPrompt(chatId, "Введите услугу или `-`, если пока пусто.", sourceMessage);
      return;
    }

    if (session.step === "service") {
      this.sessions.set(user.telegram_user_id, {
        type: "add_lead",
        step: "comment",
        draft: {
          ...session.draft,
          service: text === "-" ? null : text
        },
        sourceMessageId: session.sourceMessageId
      });

      await this.sendSessionPrompt(chatId, "Введите комментарий или `-`, чтобы пропустить.", sourceMessage);
      return;
    }

    if (session.step === "comment") {
      const lead = this.db.createLead({
        creatorUserId: user.id,
        name: session.draft.name,
        phone: session.draft.phone,
        phoneNormalized: session.draft.phoneNormalized,
        car: session.draft.car ?? null,
        service: session.draft.service ?? null,
        comment: text === "-" ? session.draft.comment ?? null : text,
        sourceType: session.draft.sourceType ?? SOURCE_TYPE.MANUAL,
        sourceLabel: session.draft.sourceLabel ?? "Ручное добавление",
        status: LEAD_STATUS.NEW
      });

      if (session.draft.createFromBlacklist) {
        this.db.removeBlacklist(session.draft.phoneNormalized, user.id);
      }

      this.db.createLeadHistory({
        leadId: lead.id,
        actorUserId: user.id,
        eventType: "created",
        eventText:
          session.draft.sourceType === SOURCE_TYPE.TELEGRAM
            ? "Лид создан из сообщения в Telegram"
            : "Лид создан вручную"
      });

      if (session.draft.inboundMessageId) {
        this.db.markInboundMessageLeadCreated(session.draft.inboundMessageId, lead.id);
      }

      this.sessions.clear(user.telegram_user_id);
      await this.showLeadCard(user, chatId, lead, sourceMessage);
    }
  }

  async handleLeadCommentSession(user, chatId, text, session) {
    const lead = this.db.updateLeadComment(session.leadId, text);
    this.db.createLeadHistory({
      leadId: session.leadId,
      actorUserId: user.id,
      eventType: "comment",
      eventText: `Комментарий обновлен: ${text}`
    });
    this.sessions.clear(user.telegram_user_id);
    await this.showLeadCard(user, chatId, lead, getSessionSourceMessage(chatId, session));
  }

  async handleLeadFollowupSession(user, chatId, text, session) {
    try {
      const nextDate = parseStrictDateTime(text, user.timezone);
      const lead = this.db.changeLeadStatus({
        leadId: session.leadId,
        status: session.status,
        nextContactAt: nextDate.toISOString(),
        lostReason: null
      });

      this.db.createLeadHistory({
        leadId: lead.id,
        actorUserId: user.id,
        eventType: "status",
        eventText: `Статус: ${LEAD_STATUS_LABELS[session.status]}`
      });

      this.db.createLeadHistory({
        leadId: lead.id,
        actorUserId: user.id,
        eventType: "next_contact",
        eventText: `Следующий контакт: ${formatFullDateTime(nextDate, user.timezone)}`
      });

      this.sessions.clear(user.telegram_user_id);
      await this.showLeadCard(user, chatId, lead, getSessionSourceMessage(chatId, session));
    } catch {
      await this.sendSessionPrompt(
        chatId,
        lines(
          "Неверный формат даты и времени.",
          "Введите в формате: ДД.ММ.ГГГГ ЧЧ:ММ",
          "Пример: 21.04.2026 15:30"
        ),
        getSessionSourceMessage(chatId, session)
      );
    }
  }

  async handleLeadLostCommentSession(user, chatId, text, session) {
    const reason = session.reason;
    const comment = text === "-" ? null : text;
    const updatedLead = this.db.changeLeadStatus({
      leadId: session.leadId,
      status: LEAD_STATUS.LOST,
      nextContactAt: null,
      lostReason: reason
    });

    if (comment) {
      this.db.updateLeadComment(session.leadId, comment);
    }

    this.db.createLeadHistory({
      leadId: session.leadId,
      actorUserId: user.id,
      eventType: "lost",
      eventText: comment
        ? `Лид переведен в потерянные. Причина: ${reason}. Комментарий: ${comment}`
        : `Лид переведен в потерянные. Причина: ${reason}`
    });

    this.sessions.clear(user.telegram_user_id);
    await this.showLeadCard(user, chatId, this.db.getLeadById(updatedLead.id), getSessionSourceMessage(chatId, session));
  }

  async handleLeadEditSession(user, chatId, text, session) {
    const sourceMessage = getSessionSourceMessage(chatId, session);
    const currentLead = this.db.getLeadById(session.leadId);
    if (!currentLead) {
      this.sessions.clear(user.telegram_user_id);
      await this.sendInlineScreen(chatId, { text: "Лид не найден." }, sourceMessage);
      return;
    }

    const field = session.field;
    const updates = {};

    if (field === "phone") {
      const phoneNormalized = normalizePhone(text);
      if (!phoneNormalized) {
        await this.sendSessionPrompt(chatId, "Некорректный телефон. Попробуйте еще раз.", sourceMessage, {
          backCallbackData: `lead:view:${currentLead.id}`,
          backText: "Назад к лиду"
        });
        return;
      }

      const blacklistEntry = this.db.getBlacklistByPhone(phoneNormalized);
      if (blacklistEntry) {
        await this.sendSessionPrompt(chatId,
          lines(
            "Номер находится в черном списке.",
            `Причина: ${blacklistEntry.reason}`,
            "Укажите другой номер или сначала уберите этот номер из ЧС."
          ),
          sourceMessage,
          {
            backCallbackData: `lead:view:${currentLead.id}`,
            backText: "Назад к лиду"
          }
        );
        return;
      }

      const duplicateLead = this.db.findActiveLeadByPhone(phoneNormalized);
      if (duplicateLead && duplicateLead.id !== currentLead.id) {
        await this.sendInlineScreen(chatId, {
          text: lines(
            "На этот номер уже есть активный лид.",
            `Имя: ${duplicateLead.name}`,
            `Статус: ${LEAD_STATUS_LABELS[duplicateLead.status] ?? duplicateLead.status}`
          ),
          reply_markup: inlineKeyboard([
            [inlineButton("Открыть существующий", { callback_data: `lead:view:${duplicateLead.id}` })],
            [inlineButton("Назад к лиду", { callback_data: `lead:view:${currentLead.id}` })]
          ])
        }, sourceMessage);
        return;
      }

      updates.phone = formatPhone(text);
      updates.phoneNormalized = phoneNormalized;
    } else if (field === "name") {
      updates.name = text;
    } else if (field === "car") {
      updates.car = text === "-" ? null : text;
    } else if (field === "service") {
      updates.service = text === "-" ? null : text;
    } else if (field === "comment") {
      updates.comment = text === "-" ? null : text;
    } else if (field === "source") {
      updates.sourceLabel = text;
      updates.sourceType = currentLead.source_type === SOURCE_TYPE.SITE ? SOURCE_TYPE.SITE : SOURCE_TYPE.MANUAL;
    }

    const lead = this.db.updateLeadEditableFields(session.leadId, updates);
    this.db.createLeadHistory({
      leadId: lead.id,
      actorUserId: user.id,
      eventType: "edit",
      eventText: `Изменено поле: ${field}`
    });

    this.sessions.clear(user.telegram_user_id);
    await this.showLeadCard(user, chatId, lead, sourceMessage);
  }

  async handleAppointmentCreateSession(user, chatId, text, session) {
    const sourceMessage = getSessionSourceMessage(chatId, session);

    if (session.step === "datetime") {
      try {
        const appointmentDate = parseStrictDateTime(text, user.timezone);
        this.sessions.set(user.telegram_user_id, {
          ...session,
          step: "service",
          appointmentAt: appointmentDate.toISOString()
        });
        await this.sendSessionPrompt(chatId, "Введите услугу для записи.", sourceMessage);
      } catch {
        await this.sendSessionPrompt(
          chatId,
          "Неверный формат. Введите дату и время как ДД.ММ.ГГГГ ЧЧ:ММ",
          sourceMessage
        );
      }
      return;
    }

    if (session.step === "service") {
      this.sessions.set(user.telegram_user_id, {
        ...session,
        step: "car",
        service: text
      });
      await this.sendSessionPrompt(chatId, "Введите авто или `-`, если не нужно.", sourceMessage);
      return;
    }

    if (session.step === "car") {
      this.sessions.set(user.telegram_user_id, {
        ...session,
        step: "comment",
        car: text === "-" ? null : text
      });
      await this.sendSessionPrompt(chatId, "Введите комментарий или `-`, чтобы пропустить.", sourceMessage);
      return;
    }

    if (session.step === "comment") {
      const appointment = this.db.createAppointment({
        leadId: session.leadId,
        service: session.service,
        car: session.car ?? null,
        comment: text === "-" ? null : text,
        appointmentAt: session.appointmentAt
      });

      this.db.createAppointmentHistory({
        appointmentId: appointment.id,
        actorUserId: user.id,
        eventType: "created",
        eventText: `Запись создана на ${formatFullDateTime(new Date(session.appointmentAt), user.timezone)}`
      });

      this.db.changeLeadStatus({
        leadId: session.leadId,
        status: LEAD_STATUS.BOOKED,
        nextContactAt: null
      });

      this.db.createLeadHistory({
        leadId: session.leadId,
        actorUserId: user.id,
        eventType: "appointment_created",
        eventText: `Создана запись на ${formatFullDateTime(new Date(session.appointmentAt), user.timezone)}`
      });

      this.sessions.clear(user.telegram_user_id);
      await this.showAppointmentCard(user, chatId, this.db.getAppointmentById(appointment.id), sourceMessage);
    }
  }

  async handleAppointmentRescheduleSession(user, chatId, text, session) {
    const sourceMessage = getSessionSourceMessage(chatId, session);

    try {
      const appointmentDate = parseStrictDateTime(text, user.timezone);
      const appointment = this.db.rescheduleAppointment(session.appointmentId, appointmentDate.toISOString());
      this.db.createAppointmentHistory({
        appointmentId: appointment.id,
        actorUserId: user.id,
        eventType: "reschedule",
        eventText: `Запись перенесена на ${formatFullDateTime(appointmentDate, user.timezone)}`
      });

      this.sessions.clear(user.telegram_user_id);
      await this.showAppointmentCard(user, chatId, appointment, sourceMessage);
    } catch {
      await this.sendSessionPrompt(
        chatId,
        "Неверный формат. Введите дату и время как ДД.ММ.ГГГГ ЧЧ:ММ",
        sourceMessage
      );
    }
  }

  async handleAppointmentCommentSession(user, chatId, text, session) {
    const appointment = this.db.updateAppointmentComment(session.appointmentId, text);
    this.db.createAppointmentHistory({
      appointmentId: appointment.id,
      actorUserId: user.id,
      eventType: "comment",
      eventText: `Комментарий обновлен: ${text}`
    });

    this.sessions.clear(user.telegram_user_id);
    await this.showAppointmentCard(user, chatId, appointment, getSessionSourceMessage(chatId, session));
  }

  async handleSummaryTimeSession(user, chatId, text) {
    const session = this.sessions.get(user.telegram_user_id);
    const sourceMessage = getSessionSourceMessage(chatId, session);

    try {
      const parsed = parseDailyTime(text);
      const updatedUser = this.db.updateUserSettings(user.id, {
        summary_time: parsed.input
      });
      this.syncSummaryUsers();
      this.sessions.clear(user.telegram_user_id);
      await this.showSettings(updatedUser, chatId, sourceMessage);
    } catch {
      await this.sendSessionPrompt(chatId, "Введите время в формате ЧЧ:ММ", sourceMessage, {
        backCallbackData: "settings:show",
        backText: "Назад к настройкам"
      });
    }
  }

  async handleTimezoneSession(user, chatId, text) {
    const session = this.sessions.get(user.telegram_user_id);
    const sourceMessage = getSessionSourceMessage(chatId, session);

    try {
      const timezone = validateTimeZone(text.trim());
      const updatedUser = this.db.updateUserSettings(user.id, {
        timezone
      });
      this.syncSummaryUsers();
      this.sessions.clear(user.telegram_user_id);
      await this.showSettings(updatedUser, chatId, sourceMessage);
    } catch {
      await this.sendSessionPrompt(chatId, "Неверная timezone. Пример: Europe/Moscow", sourceMessage, {
        backCallbackData: "settings:show",
        backText: "Назад к настройкам"
      });
    }
  }

  async handleBlacklistAddSession(user, chatId, text, session) {
    const sourceMessage = getSessionSourceMessage(chatId, session);

    if (session.step === "phone") {
      const phoneNormalized = normalizePhone(text);
      if (!phoneNormalized) {
        await this.sendSessionPrompt(chatId, "Не удалось распознать номер. Попробуйте еще раз.", sourceMessage, {
          backCallbackData: "blacklist:show",
          backText: "Назад к ЧС"
        });
        return;
      }

      this.sessions.set(user.telegram_user_id, {
        type: "blacklist_add",
        step: "name",
        draft: {
          phone: formatPhone(text),
          phoneNormalized
        },
        sourceMessageId: session.sourceMessageId
      });
      await this.sendSessionPrompt(chatId, "Введите имя или пометку для этого номера, либо `-`.", sourceMessage, {
        backCallbackData: "blacklist:show",
        backText: "Назад к ЧС"
      });
      return;
    }

    if (session.step === "name") {
      this.sessions.set(user.telegram_user_id, {
        type: "blacklist_add",
        step: "reason",
        draft: {
          ...session.draft,
          nameLabel: text === "-" ? null : text
        },
        sourceMessageId: session.sourceMessageId
      });

      await this.sendInlineScreen(chatId, {
        text: "Выберите причину для ЧС.",
        reply_markup: inlineKeyboard([
          ...BLACKLIST_REASON_OPTIONS.map((reason, index) => [
            inlineButton(reason, { callback_data: `blacklist:reason:${index}` })
          ]),
          [inlineButton("Отмена", { callback_data: "session:cancel" })]
        ])
      }, sourceMessage);
      return;
    }

    if (session.step === "comment") {
      const entry = this.db.addBlacklistEntry({
        phone: session.draft.phone,
        phoneNormalized: session.draft.phoneNormalized,
        nameLabel: session.draft.nameLabel ?? null,
        reason: session.draft.reason,
        comment: text === "-" ? null : text,
        actorUserId: user.id
      });

      this.sessions.clear(user.telegram_user_id);
      await this.showBlacklistCard(chatId, entry, sourceMessage);
      return;
    }
  }

  async showMainMenu(user, chatId, messageText = "Главное меню") {
    const counts = await this.getMainMenuCounts(user);

    await this.telegram.sendMessage({
      chat_id: chatId,
      text: messageText,
      reply_markup: buildMainMenuKeyboard(counts, user)
    });
  }

  async showSettings(user, chatId, sourceMessage = null) {
    await this.sendInlineScreen(chatId, {
      parse_mode: "HTML",
      text: lines(
        "<b>Настройки</b>",
        `Часовой пояс: <code>${escapeHtml(user.timezone)}</code>`,
        `Время сводки: <code>${escapeHtml(user.summary_time)}</code>`,
        `Ежедневная сводка: <b>${escapeHtml(boolToOnOff(user.summary_enabled))}</b>`
      ),
      reply_markup: inlineKeyboard(
        compactInlineRows([
          [
            inlineButton(
              `${user.summary_enabled ? "Выключить" : "Включить"} сводку`,
              { callback_data: "settings:toggle_summary" }
            )
          ],
          [
            inlineButton("Изменить время", { callback_data: "settings:set_time" }),
            inlineButton("Изменить timezone", { callback_data: "settings:set_timezone" })
          ],
          user.role === ROLES.OWNER
            ? [inlineButton("Сотрудники", { callback_data: "settings:employees" })]
            : null,
          [inlineButton("В меню", { callback_data: "nav:main" })]
        ])
      )
    }, sourceMessage);
  }

  async showEmployees(user, chatId, sourceMessage = null) {
    const employees = this.db.listEmployees();
    const pendingRequests = this.db.listPendingAccessRequests();

    const rows = compactInlineRows([
      ...pendingRequests.flatMap((request) => [
        [
          inlineButton(`Одобрить ${truncateText(request.full_name, 18)}`, {
            callback_data: `access:approve:${request.id}`
          }),
          inlineButton("Отклонить", {
            callback_data: `access:reject:${request.id}`
          })
        ]
      ]),
      ...employees
        .filter((employee) => employee.id !== user.id)
        .map((employee) => [
          inlineButton(
            `Отключить ${truncateText(employee.full_name, 18)}`,
            {
              callback_data: `employees:revoke:${employee.id}`
            }
          )
        ]),
      [inlineButton("Назад к настройкам", { callback_data: "settings:show" })]
    ]);

    await this.sendInlineScreen(chatId, {
      parse_mode: "HTML",
      text: lines(
        "<b>Сотрудники</b>",
        `Запросы доступа: <b>${pendingRequests.length}</b>`,
        `Активные сотрудники: <b>${employees.length}</b>`,
        "",
        "Чтобы новый сотрудник попал в бота, он должен открыть бота и отправить /start."
      ),
      reply_markup: inlineKeyboard(rows)
    }, sourceMessage);
  }

  async showLeadSection(user, chatId, section, filter = "all", sourceMessage = null) {
    const rows = this.db.listLeadsForSection(section, {
      temperature: filter,
      now: new Date().toISOString()
    });

    const titleMap = {
      new: "Новые заявки",
      in_work: "В работе",
      postponed: "Отложенные",
      overdue: "Просроченные"
    };

    const keyboardRows = compactInlineRows([
      [ ...buildTemperatureFilterRow(section, filter) ],
      ...rows.slice(0, 20).map((lead) => [
        inlineButton(formatLeadListLabel(lead, user.timezone), {
          callback_data: `lead:view:${lead.id}`
        })
      ]),
      [inlineButton("В меню", { callback_data: "nav:main" })]
    ]);

    await this.sendInlineScreen(chatId, {
      parse_mode: "HTML",
      text: lines(
        `<b>${escapeHtml(titleMap[section] ?? section)}</b>`,
        `Лидов: <b>${rows.length}</b>`,
        rows.length === 0 ? "Пока пусто." : "Выберите лид:"
      ),
      reply_markup: inlineKeyboard(keyboardRows)
    }, sourceMessage);
  }

  async showDayOverview(user, chatId, day, sourceMessage = null) {
    const label = day === "today" ? "Сегодня" : "Завтра";
    const range = this.getDayRange(user.timezone, day);
    const contacts = this.db.listLeadsByNextContactRange(range.start.toISOString(), range.end.toISOString());
    const appointments = this.db.listAppointmentsByRange(range.start.toISOString(), range.end.toISOString());

    await this.sendInlineScreen(chatId, {
      parse_mode: "HTML",
      text: lines(
        `<b>${label}</b>`,
        `Касания: <b>${contacts.length}</b>`,
        `Записи: <b>${appointments.length}</b>`
      ),
      reply_markup: inlineKeyboard([
        [
          inlineButton(`Касания (${contacts.length})`, { callback_data: `day:view:${day}:contacts` }),
          inlineButton(`Записи (${appointments.length})`, { callback_data: `day:view:${day}:appointments` })
        ],
        [inlineButton("В меню", { callback_data: "nav:main" })]
      ])
    }, sourceMessage);
  }

  async showDayDetail(user, chatId, day, type, sourceMessage = null) {
    const range = this.getDayRange(user.timezone, day);
    const titlePrefix = day === "today" ? "Сегодня" : "Завтра";

    if (type === "contacts") {
      const leads = this.db.listLeadsByNextContactRange(range.start.toISOString(), range.end.toISOString());
      await this.sendInlineScreen(chatId, {
        parse_mode: "HTML",
        text: lines(
          `<b>${titlePrefix} — касания</b>`,
          `Лидов: <b>${leads.length}</b>`
        ),
        reply_markup: inlineKeyboard(
          compactInlineRows([
            ...leads.slice(0, 20).map((lead) => [
              inlineButton(formatLeadListLabel(lead, user.timezone), {
                callback_data: `lead:view:${lead.id}`
              })
            ]),
            [inlineButton("Назад", { callback_data: `day:view:${day}:overview` })],
            [inlineButton("В меню", { callback_data: "nav:main" })]
          ])
        )
      }, sourceMessage);
      return;
    }

    const appointments = this.db.listAppointmentsByRange(range.start.toISOString(), range.end.toISOString());
    await this.sendInlineScreen(chatId, {
      parse_mode: "HTML",
      text: lines(
        `<b>${titlePrefix} — записи</b>`,
        `Записей: <b>${appointments.length}</b>`
      ),
      reply_markup: inlineKeyboard(
        compactInlineRows([
          ...appointments.slice(0, 20).map((appointment) => [
            inlineButton(formatAppointmentListLabel(appointment, user.timezone), {
              callback_data: `appt:view:${appointment.id}`
            })
          ]),
          [inlineButton("Назад", { callback_data: `day:view:${day}:overview` })],
          [inlineButton("В меню", { callback_data: "nav:main" })]
        ])
      )
    }, sourceMessage);
  }

  async showLeadCard(user, chatId, lead, sourceMessage = null) {
    const text = this.renderLeadCardText(lead, user.timezone);
    const keyboard = inlineKeyboard(
      compactInlineRows([
        [
          inlineButton("Связаться", { callback_data: `lead:contact:${lead.id}` }),
          inlineButton("Результат", { callback_data: `lead:result_menu:${lead.id}` })
        ],
        [
          inlineButton("Температура", { callback_data: `lead:temp_menu:${lead.id}` }),
          inlineButton("Комментарий", { callback_data: `lead:comment:${lead.id}` })
        ],
        [
          inlineButton("История", { callback_data: `lead:history:${lead.id}` }),
          inlineButton("История клиента", { callback_data: `lead:client_history:${lead.id}` })
        ],
        lead.status === LEAD_STATUS.LOST
          ? [inlineButton("Вернуть в работу", { callback_data: `lead:restore:${lead.id}` })]
          : null,
        [
          inlineButton("Создать запись", { callback_data: `lead:create_appointment:${lead.id}` }),
          inlineButton("Редактировать", { callback_data: `lead:edit_menu:${lead.id}` })
        ],
        [
          inlineButton("В ЧС", { callback_data: `lead:blacklist_menu:${lead.id}` }),
          inlineButton("Удалить", { callback_data: `lead:delete_confirm:${lead.id}` })
        ],
        [inlineButton("В меню", { callback_data: "nav:main" })]
      ])
    );

    await this.sendInlineScreen(chatId, {
      parse_mode: "HTML",
      text,
      reply_markup: keyboard
    }, sourceMessage);
  }

  async showAppointmentCard(user, chatId, appointment, sourceMessage = null) {
    await this.sendInlineScreen(chatId, {
      parse_mode: "HTML",
      text: this.renderAppointmentCardText(appointment, user.timezone),
      reply_markup: inlineKeyboard([
        [
          inlineButton("Изменить статус", { callback_data: `appt:status_menu:${appointment.id}` }),
          inlineButton("Перенести", { callback_data: `appt:reschedule:${appointment.id}` })
        ],
        [
          inlineButton("Комментарий", { callback_data: `appt:comment:${appointment.id}` }),
          inlineButton("Открыть лид", { callback_data: `appt:lead:${appointment.id}` })
        ],
        [
          inlineButton("История записи", { callback_data: `appt:history:${appointment.id}` }),
          inlineButton("История клиента", { callback_data: `appt:client_history:${appointment.id}` }),
          inlineButton("В меню", { callback_data: "nav:main" })
        ]
      ])
    }, sourceMessage);
  }

  async showLeadHistory(chatId, lead, timeZone, sourceMessage = null) {
    const history = this.db.getLeadHistory(lead.id);

    await this.sendInlineScreen(chatId, {
      parse_mode: "HTML",
      text: lines(
        `<b>История лида</b>`,
        ...history.slice(0, 20).map((item) =>
          `${escapeHtml(formatLeadDate(new Date(item.created_at), timeZone))} — ${escapeHtml(
            item.event_text
          )}${item.actor_name ? ` — ${escapeHtml(item.actor_name)}` : ""}`
        ),
        history.length === 0 ? "История пока пустая." : undefined
      ),
      reply_markup: inlineKeyboard([[inlineButton("Назад к лиду", { callback_data: `lead:view:${lead.id}` })]])
    }, sourceMessage);
  }

  async showClientHistory(chatId, phoneNormalized, timeZone, sourceMessage = null, backCallbackData = "nav:main") {
    const timeline = this.db.getClientTimeline(phoneNormalized);

    await this.sendInlineScreen(chatId, {
      parse_mode: "HTML",
      text: lines(
        `<b>История клиента</b>`,
        ...timeline.slice(0, 25).map((item) =>
          `${escapeHtml(formatLeadDate(new Date(item.happened_at), timeZone))} — ${
            item.item_type === "lead" ? "Лид" : "Запись"
          } — ${escapeHtml(item.status)}${item.service ? ` — ${escapeHtml(item.service)}` : ""}`
        ),
        timeline.length === 0 ? "История пока пустая." : undefined
      ),
      reply_markup: inlineKeyboard([[inlineButton("Назад", { callback_data: backCallbackData })]])
    }, sourceMessage);
  }

  async showAppointmentHistory(chatId, appointment, timeZone, sourceMessage = null) {
    const history = this.db.getAppointmentHistory(appointment.id);

    await this.sendInlineScreen(chatId, {
      parse_mode: "HTML",
      text: lines(
        "<b>История записи</b>",
        ...history.slice(0, 20).map((item) =>
          `${escapeHtml(formatLeadDate(new Date(item.created_at), timeZone))} — ${escapeHtml(
            item.event_text
          )}${item.actor_name ? ` — ${escapeHtml(item.actor_name)}` : ""}`
        ),
        history.length === 0 ? "История пока пустая." : undefined
      ),
      reply_markup: inlineKeyboard([[inlineButton("Назад к записи", { callback_data: `appt:view:${appointment.id}` })]])
    }, sourceMessage);
  }

  async showLeadResultMenu(chatId, lead) {
    await this.sendLeadResultMenu(chatId, lead);
  }

  async sendLeadResultMenu(chatId, lead, sourceMessage = null) {
    await this.sendInlineScreen(chatId, {
      text: "Выберите результат по лиду.",
      reply_markup: inlineKeyboard([
        [
          inlineButton("В работе", { callback_data: `lead:result:${lead.id}:${LEAD_STATUS.IN_PROGRESS}` }),
          inlineButton("Ждет решения", {
            callback_data: `lead:result:${lead.id}:${LEAD_STATUS.WAITING_DECISION}`
          })
        ],
        [
          inlineButton("Записан", { callback_data: `lead:result:${lead.id}:${LEAD_STATUS.BOOKED}` }),
          inlineButton("Не ответил", { callback_data: `lead:result:${lead.id}:${LEAD_STATUS.NO_ANSWER}` })
        ],
        [
          inlineButton("Отложен", { callback_data: `lead:result:${lead.id}:${LEAD_STATUS.POSTPONED}` }),
          inlineButton("Потерян", { callback_data: `lead:result:${lead.id}:${LEAD_STATUS.LOST}` })
        ],
        [inlineButton("Назад к лиду", { callback_data: `lead:view:${lead.id}` })]
      ])
    }, sourceMessage);
  }

  async handleLeadResultSelection(user, chatId, lead, status, sourceMessage = null) {
    if (status === LEAD_STATUS.WAITING_DECISION || status === LEAD_STATUS.NO_ANSWER || status === LEAD_STATUS.POSTPONED) {
      this.sessions.set(
        user.telegram_user_id,
        withSourceMessage(
          {
            type: "lead_followup",
            leadId: lead.id,
            status
          },
          sourceMessage
        )
      );
      await this.sendSessionPrompt(
        chatId,
        "Введите дату и время следующего контакта в формате ДД.ММ.ГГГГ ЧЧ:ММ",
        sourceMessage,
        {
          backCallbackData: `lead:view:${lead.id}`,
          backText: "Назад к лиду"
        }
      );
      return;
    }

    if (status === LEAD_STATUS.BOOKED) {
      await this.startAppointmentFlow(user, chatId, lead.id, sourceMessage);
      return;
    }

    if (status === LEAD_STATUS.LOST) {
      await this.sendInlineScreen(chatId, {
        text: "Выберите причину потери лида.",
        reply_markup: inlineKeyboard([
          ...LOST_REASON_OPTIONS.map((reason, index) => [
            inlineButton(reason, { callback_data: `lead:lost_reason:${lead.id}:${index}` })
          ]),
          [inlineButton("Назад к лиду", { callback_data: `lead:view:${lead.id}` })]
        ])
      }, sourceMessage);
      return;
    }

    const updatedLead = this.db.changeLeadStatus({
      leadId: lead.id,
      status,
      nextContactAt: null
    });

    this.db.createLeadHistory({
      leadId: lead.id,
      actorUserId: user.id,
      eventType: "status",
      eventText: `Статус: ${LEAD_STATUS_LABELS[status]}`
    });

    await this.showLeadCard(user, chatId, updatedLead, sourceMessage);
  }

  async startLeadLostFlow(user, chatId, lead, reasonIndexRaw, sourceMessage = null) {
    const reasonIndex = parseZeroBasedIndex(reasonIndexRaw);
    const reason = LOST_REASON_OPTIONS[reasonIndex ?? 0] ?? LOST_REASON_OPTIONS[0];

    this.sessions.set(
      user.telegram_user_id,
      withSourceMessage(
        {
          type: "lead_lost_comment",
          leadId: lead.id,
          reason
        },
        sourceMessage
      )
    );

    await this.sendSessionPrompt(chatId, `Причина выбрана: ${reason}\n\nВведите комментарий или "-" чтобы пропустить.`, sourceMessage, {
      backCallbackData: `lead:view:${lead.id}`,
      backText: "Назад к лиду"
    });
  }

  async sendLeadTemperatureMenu(chatId, lead, sourceMessage = null) {
    await this.sendInlineScreen(chatId, {
      text: "Выберите температуру лида.",
      reply_markup: inlineKeyboard([
        [
          inlineButton("Горячий", { callback_data: `lead:temp:${lead.id}:${LEAD_TEMPERATURE.HOT}` }),
          inlineButton("Теплый", { callback_data: `lead:temp:${lead.id}:${LEAD_TEMPERATURE.WARM}` })
        ],
        [
          inlineButton("Холодный", { callback_data: `lead:temp:${lead.id}:${LEAD_TEMPERATURE.COLD}` }),
          inlineButton("Сбросить", { callback_data: `lead:temp:${lead.id}:clear` })
        ],
        [inlineButton("Назад к лиду", { callback_data: `lead:view:${lead.id}` })]
      ])
    }, sourceMessage);
  }

  async setLeadTemperature(user, chatId, lead, temperature, sourceMessage = null) {
    const normalized = temperature === "clear" ? null : temperature;
    const updatedLead = this.db.changeLeadTemperature(lead.id, normalized);

    this.db.createLeadHistory({
      leadId: lead.id,
      actorUserId: user.id,
      eventType: "temperature",
      eventText: normalized ? `Температура: ${LEAD_TEMPERATURE_LABELS[normalized]}` : "Температура сброшена"
    });

    await this.showLeadCard(user, chatId, updatedLead, sourceMessage);
  }

  async showLeadEditMenu(chatId, lead, sourceMessage = null) {
    await this.sendInlineScreen(chatId, {
      text: "Выберите поле для редактирования.",
      reply_markup: inlineKeyboard([
        [
          inlineButton("Имя", { callback_data: `lead:edit:${lead.id}:name` }),
          inlineButton("Телефон", { callback_data: `lead:edit:${lead.id}:phone` })
        ],
        [
          inlineButton("Авто", { callback_data: `lead:edit:${lead.id}:car` }),
          inlineButton("Услуга", { callback_data: `lead:edit:${lead.id}:service` })
        ],
        [
          inlineButton("Комментарий", { callback_data: `lead:edit:${lead.id}:comment` }),
          inlineButton("Источник", { callback_data: `lead:edit:${lead.id}:source` })
        ],
        [inlineButton("Назад к лиду", { callback_data: `lead:view:${lead.id}` })]
      ])
    }, sourceMessage);
  }

  getLeadEditPrompt(field) {
    switch (field) {
      case "name":
        return "Введите новое имя.";
      case "phone":
        return "Введите новый телефон.";
      case "car":
        return "Введите авто или `-`.";
      case "service":
        return "Введите услугу или `-`.";
      case "comment":
        return "Введите комментарий или `-`.";
      case "source":
        return "Введите новый источник.";
      default:
        return "Введите новое значение.";
    }
  }

  async showLeadContactMenu(chatId, lead, sourceMessage = null) {
    const whatsAppPhone = formatWhatsAppPhone(lead.phone);
    const rows = compactInlineRows([
      [
        inlineButton("Позвонить", { url: `tel:${lead.phone}` }),
        whatsAppPhone
          ? inlineButton("Написать", { url: `https://wa.me/${whatsAppPhone}` })
          : null
      ],
      [inlineButton("После связи — результат", { callback_data: `lead:result_menu:${lead.id}` })],
      [inlineButton("Назад к лиду", { callback_data: `lead:view:${lead.id}` })]
    ]);

    await this.sendInlineScreen(chatId, {
      parse_mode: "HTML",
      text: lines(
        "<b>Контакт с клиентом</b>",
        `Телефон: <code>${escapeHtml(lead.phone)}</code>`
      ),
      reply_markup: inlineKeyboard(rows)
    }, sourceMessage);
  }

  async showLeadBlacklistMenu(chatId, lead, sourceMessage = null) {
    await this.sendInlineScreen(chatId, {
      text: "Выберите причину для черного списка.",
      reply_markup: inlineKeyboard([
        ...BLACKLIST_REASON_OPTIONS.map((reason, index) => [
          inlineButton(reason, { callback_data: `lead:blacklist_reason:${lead.id}:${index}` })
        ]),
        [inlineButton("Назад к лиду", { callback_data: `lead:view:${lead.id}` })]
      ])
    }, sourceMessage);
  }

  async blacklistLeadByReason(user, chatId, lead, reasonIndexRaw, sourceMessage = null) {
    const reasonIndex = parseZeroBasedIndex(reasonIndexRaw);
    const reason = BLACKLIST_REASON_OPTIONS[reasonIndex ?? 0] ?? BLACKLIST_REASON_OPTIONS[0];

    this.sessions.set(
      user.telegram_user_id,
      withSourceMessage(
        {
          type: "lead_blacklist_comment",
          leadId: lead.id,
          reason
        },
        sourceMessage
      )
    );

    await this.sendSessionPrompt(
      chatId,
      `Причина выбрана: ${reason}\n\nВведите комментарий для ЧС или "-" чтобы пропустить.`,
      sourceMessage,
      {
        backCallbackData: `lead:view:${lead.id}`,
        backText: "Назад к лиду"
      }
    );
  }

  async showLeadDeleteConfirmation(chatId, lead, sourceMessage = null) {
    await this.sendInlineScreen(chatId, {
      parse_mode: "HTML",
      text: lines(
        "<b>Точно удалить лид?</b>",
        `Имя: ${escapeHtml(lead.name)}`,
        `Телефон: <code>${escapeHtml(lead.phone)}</code>`,
        "",
        "Действие необратимо."
      ),
      reply_markup: inlineKeyboard([
        [
          inlineButton("Да, удалить", { callback_data: `lead:delete:${lead.id}` }),
          inlineButton("Отмена", { callback_data: `lead:view:${lead.id}` })
        ]
      ])
    }, sourceMessage);
  }

  async deleteLead(user, chatId, lead) {
    this.db.deleteLead(lead.id, user.id);
    this.db.createLeadHistory({
      leadId: lead.id,
      actorUserId: user.id,
      eventType: "delete",
      eventText: "Лид удален"
    });

    await this.showMainMenu(user, chatId, "Лид удален.");
  }

  async restoreLostLead(user, chatId, lead, sourceMessage = null) {
    const restoredLead = this.db.changeLeadStatus({
      leadId: lead.id,
      status: LEAD_STATUS.IN_PROGRESS,
      nextContactAt: null,
      lostReason: null
    });

    this.db.createLeadHistory({
      leadId: lead.id,
      actorUserId: user.id,
      eventType: "restore",
      eventText: "Лид возвращен в работу"
    });

    await this.showLeadCard(user, chatId, restoredLead, sourceMessage);
  }

  async startAppointmentFlow(user, chatId, leadId, sourceMessage = null) {
    this.sessions.set(
      user.telegram_user_id,
      withSourceMessage(
        {
          type: "appointment_create",
          leadId,
          step: "datetime"
        },
        sourceMessage
      )
    );
    await this.sendSessionPrompt(chatId, "Введите дату и время записи в формате ДД.ММ.ГГГГ ЧЧ:ММ", sourceMessage, {
      backCallbackData: `lead:view:${leadId}`,
      backText: "Назад к лиду"
    });
  }

  async showAppointmentStatusMenu(chatId, appointment, sourceMessage = null) {
    await this.sendInlineScreen(chatId, {
      text: "Выберите новый статус записи.",
      reply_markup: inlineKeyboard([
        [
          inlineButton("Назначена", {
            callback_data: `appt:status:${appointment.id}:${APPOINTMENT_STATUS.SCHEDULED}`
          }),
          inlineButton("Подтверждена", {
            callback_data: `appt:status:${appointment.id}:${APPOINTMENT_STATUS.CONFIRMED}`
          })
        ],
        [
          inlineButton("Перенесена", {
            callback_data: `appt:status:${appointment.id}:${APPOINTMENT_STATUS.RESCHEDULED}`
          }),
          inlineButton("В работе", {
            callback_data: `appt:status:${appointment.id}:${APPOINTMENT_STATUS.IN_PROGRESS}`
          })
        ],
        [
          inlineButton("Выполнена", {
            callback_data: `appt:status:${appointment.id}:${APPOINTMENT_STATUS.COMPLETED}`
          }),
          inlineButton("Не приехал", {
            callback_data: `appt:status:${appointment.id}:${APPOINTMENT_STATUS.NO_SHOW}`
          })
        ],
        [
          inlineButton("Отменена", {
            callback_data: `appt:status:${appointment.id}:${APPOINTMENT_STATUS.CANCELED}`
          })
        ],
        [inlineButton("Назад к записи", { callback_data: `appt:view:${appointment.id}` })]
      ])
    }, sourceMessage);
  }

  async setAppointmentStatus(user, chatId, appointment, status, sourceMessage = null) {
    const updated = this.db.updateAppointmentStatus(appointment.id, status);
    this.db.createAppointmentHistory({
      appointmentId: appointment.id,
      actorUserId: user.id,
      eventType: "status",
      eventText: `Статус записи: ${APPOINTMENT_STATUS_LABELS[status] ?? status}`
    });

    await this.showAppointmentCard(user, chatId, updated, sourceMessage);
  }

  async showMessagesOverview(user, chatId, sourceMessage = null) {
    const newCount = this.db.countNewInboundMessages();
    const allCount = this.db.listInboundMessages("all").length;

    await this.sendInlineScreen(chatId, {
      parse_mode: "HTML",
      text: lines(
        "<b>Сообщения</b>",
        `Новые: <b>${newCount}</b>`,
        `Всего: <b>${allCount}</b>`
      ),
      reply_markup: inlineKeyboard([
        [
          inlineButton(`Новые сообщения (${newCount})`, { callback_data: "messages:list:new" }),
          inlineButton("Все сообщения", { callback_data: "messages:list:all" })
        ],
        [inlineButton("В меню", { callback_data: "nav:main" })]
      ])
    }, sourceMessage);
  }

  async showMessagesList(user, chatId, filter = "new", sourceMessage = null) {
    const normalizedFilter = filter === "all" ? "all" : "new";
    const messages = this.db.listInboundMessages(normalizedFilter);
    const title = normalizedFilter === "new" ? "Новые сообщения" : "Все сообщения";

    await this.sendInlineScreen(chatId, {
      parse_mode: "HTML",
      text: lines(
        `<b>${title}</b>`,
        `Сообщений: <b>${messages.length}</b>`,
        messages.length === 0 ? "Пока пусто." : "Выберите сообщение:"
      ),
      reply_markup: inlineKeyboard(
        compactInlineRows([
          ...messages.slice(0, 20).map((message) => [
            inlineButton(formatInboundMessageListLabel(message, user.timezone), {
              callback_data: `messages:open:${message.id}`
            })
          ]),
          [inlineButton("Назад", { callback_data: "messages:overview" })],
          [inlineButton("В меню", { callback_data: "nav:main" })]
        ])
      )
    }, sourceMessage);
  }

  async showInboundMessageCard(user, chatId, inboundMessage, sourceMessage = null) {
    const replies = this.db.listInboundMessageReplies(inboundMessage.id);
    const clientMessages = this.db
      .listInboundMessagesByTelegramUserId(inboundMessage.telegram_user_id)
      .filter((message) => message.id !== inboundMessage.id);

    await this.sendInlineScreen(chatId, {
      parse_mode: "HTML",
      text: lines(
        "<b>Сообщение из Telegram</b>",
        `Статус: <b>${escapeHtml(inboundMessageStatusLabel(inboundMessage.status))}</b>`,
        `Имя: ${escapeHtml(inboundMessage.full_name)}`,
        `Username: ${escapeHtml(inboundMessage.username ? `@${inboundMessage.username}` : "—")}`,
        inboundMessage.phone ? `Телефон в тексте: <code>${escapeHtml(inboundMessage.phone)}</code>` : undefined,
        `Дата: ${escapeHtml(formatFullDateTime(new Date(inboundMessage.created_at), user.timezone))}`,
        "",
        escapeHtml(inboundMessage.text),
        replies.length ? "" : undefined,
        replies.length ? "<b>Ответы</b>" : undefined,
        ...replies.map((reply) =>
          lines(
            `${escapeHtml(formatLeadDate(new Date(reply.created_at), user.timezone))} — ${escapeHtml(
              reply.actor_name ?? "Сотрудник"
            )}`,
            escapeHtml(reply.text)
          )
        ),
        clientMessages.length ? "" : undefined,
        clientMessages.length ? "<b>Другие сообщения клиента</b>" : undefined,
        ...clientMessages.slice(0, 5).map((message) =>
          `${escapeHtml(formatLeadDate(new Date(message.created_at), user.timezone))} — ${escapeHtml(
            inboundMessageStatusLabel(message.status)
          )} — ${escapeHtml(truncateText(message.text, 80))}`
        )
      ),
      reply_markup: inlineKeyboard(
        compactInlineRows([
          [
            inlineButton("Ответить", { callback_data: `inbox:reply:${inboundMessage.id}` }),
            inboundMessage.status === "lead_created"
              ? null
              : inlineButton("Создать лид", { callback_data: `inbox:create_lead:${inboundMessage.id}` })
          ],
          inboundMessage.status === "new"
            ? [
                inlineButton("Игнорировать", { callback_data: `inbox:ignore:${inboundMessage.id}` })
              ]
            : null,
          [inlineButton("Назад", { callback_data: "messages:list:new" })],
          [inlineButton("Все сообщения", { callback_data: "messages:list:all" })]
        ])
      )
    }, sourceMessage);
  }

  async showBlacklistSection(user, chatId, sourceMessage = null) {
    const rows = this.db.listBlacklist();
    await this.sendInlineScreen(chatId, {
      parse_mode: "HTML",
      text: lines("<b>Черный список</b>", `Номеров: <b>${rows.length}</b>`),
      reply_markup: inlineKeyboard(
        compactInlineRows([
          ...rows.slice(0, 20).map((entry) => [
            inlineButton(`${truncateText(textOrDash(entry.name_label), 18)} | ${formatPhone(entry.phone)}`, {
              callback_data: `blacklist:view:${entry.phone_normalized}`
            })
          ]),
          [inlineButton("Добавить номер", { callback_data: "blacklist:add" })],
          [inlineButton("В меню", { callback_data: "nav:main" })]
        ])
      )
    }, sourceMessage);
  }

  async showBlacklistCard(chatId, entry, sourceMessage = null) {
    const leadId = this.getLatestLeadIdByPhone(entry.phone_normalized);
    await this.sendInlineScreen(chatId, {
      parse_mode: "HTML",
      text: lines(
        "<b>Черный список</b>",
        `Имя/пометка: ${escapeHtml(textOrDash(entry.name_label))}`,
        `Телефон: <code>${escapeHtml(entry.phone)}</code>`,
        `Причина: ${escapeHtml(entry.reason)}`,
        `Комментарий: ${escapeHtml(textOrDash(entry.comment))}`,
        `Добавлено: ${escapeHtml(formatFullDateTime(new Date(entry.created_at), this.config.defaultTimeZone))}`
      ),
      reply_markup: inlineKeyboard(
        compactInlineRows([
          [
            inlineButton("Убрать из ЧС", {
              callback_data: `blacklist:remove:${entry.phone_normalized}`
            }),
            leadId
              ? inlineButton("История клиента", {
                  callback_data: `lead:client_history:${leadId}`
                })
              : null
          ],
          [inlineButton("Назад", { callback_data: "blacklist:show" })]
        ])
      )
    }, sourceMessage);
  }

  async toggleUserSummary(user, chatId, sourceMessage = null) {
    const updatedUser = this.db.updateUserSettings(user.id, {
      summary_enabled: !user.summary_enabled
    });
    this.syncSummaryUsers();
    await this.showSettings(updatedUser, chatId, sourceMessage);
  }

  async sendDailySummary(user) {
    const counts = await this.getMainMenuCounts(user);

    await this.telegram.sendMessage({
      chat_id: user.telegram_user_id,
      parse_mode: "HTML",
      text: lines(
        "<b>Сводка на сегодня</b>",
        `${escapeHtml(getLocalDateLabel(new Date(), user.timezone))} | ${escapeHtml(user.summary_time)} ${escapeHtml(
          user.timezone
        )}`,
        "",
        `Просроченные касания: <b>${counts.overdueContacts}</b>`,
        `Новые заявки без обработки: <b>${counts.newUnprocessed}</b>`,
        "",
        "<b>Сегодня</b>",
        `Касания: <b>${counts.todayContacts}</b>`,
        `Записи: <b>${counts.todayAppointments}</b>`,
        "",
        "<b>Завтра</b>",
        `Касания: <b>${counts.tomorrowContacts}</b>`,
        `Записи: <b>${counts.tomorrowAppointments}</b>`,
        "",
        `Отложенные: <b>${counts.postponed}</b>`
      ),
      reply_markup: inlineKeyboard([
        [
          inlineButton("Просроченные", { callback_data: "section:view:overdue:all" }),
          inlineButton("Новые заявки", { callback_data: "section:view:new:all" })
        ],
        [
          inlineButton("Сегодня", { callback_data: "day:view:today:overview" }),
          inlineButton("Завтра", { callback_data: "day:view:tomorrow:overview" })
        ]
      ])
    });
  }

  async notifyNewLead(lead) {
    const users = this.db.listActiveUsers();
    await Promise.all(
      users.map((user) =>
        this.telegram.sendMessage({
          chat_id: user.telegram_user_id,
          parse_mode: "HTML",
          text: this.renderNewLeadNotification(lead, user.timezone),
          reply_markup: inlineKeyboard([
            [
              inlineButton("Открыть", { callback_data: `lead:view:${lead.id}` }),
              inlineButton("Связаться", { callback_data: `lead:contact:${lead.id}` })
            ],
            [
              inlineButton("Результат", { callback_data: `lead:result_menu:${lead.id}` }),
              inlineButton("В ЧС", { callback_data: `lead:blacklist_menu:${lead.id}` })
            ]
          ])
        })
      )
    );
  }

  async notifyDuplicateLead(existingLead, payload) {
    const users = this.db.listActiveUsers();
    const text = lines(
      "<b>Повторная заявка по существующему номеру</b>",
      `Имя: ${escapeHtml(payload.name || existingLead.name)}`,
      `Телефон: <code>${escapeHtml(existingLead.phone)}</code>`,
      `Текущий статус: ${escapeHtml(LEAD_STATUS_LABELS[existingLead.status] ?? existingLead.status)}`
    );

    await Promise.all(
      users.map((user) =>
        this.telegram.sendMessage({
          chat_id: user.telegram_user_id,
          parse_mode: "HTML",
          text,
          reply_markup: inlineKeyboard([[inlineButton("Открыть лид", { callback_data: `lead:view:${existingLead.id}` })]])
        })
      )
    );
  }

  async notifyBlacklistHit({ phone, name, service, comment, blacklistEntry }) {
    const users = this.db.listActiveUsers();
    const text = lines(
      "<b>Номер из черного списка снова оставил заявку</b>",
      `Имя: ${escapeHtml(textOrDash(name))}`,
      `Телефон: <code>${escapeHtml(phone)}</code>`,
      `Услуга: ${escapeHtml(textOrDash(service))}`,
      `Комментарий: ${escapeHtml(textOrDash(comment))}`,
      `Причина в ЧС: ${escapeHtml(blacklistEntry.reason)}`
    );

    await Promise.all(
      users.map((user) =>
        this.telegram.sendMessage({
          chat_id: user.telegram_user_id,
          parse_mode: "HTML",
          text,
          reply_markup: inlineKeyboard([
            [
              inlineButton("Открыть ЧС", {
                callback_data: `blacklist:view:${blacklistEntry.phone_normalized}`
              }),
              inlineButton("Убрать из ЧС и создать лид", {
                callback_data: `lead:create_from_blacklist:${blacklistEntry.phone_normalized}`
              })
            ]
          ])
        })
      )
    );
  }

  async notifyIncomingTelegramMessage(inboundMessage) {
    const users = this.db.listActiveUsers();
    const text = lines(
      "<b>Новое сообщение в Telegram</b>",
      `Имя: ${escapeHtml(inboundMessage.full_name)}`,
      `Username: ${escapeHtml(inboundMessage.username ? `@${inboundMessage.username}` : "—")}`,
      inboundMessage.phone ? `Телефон в тексте: <code>${escapeHtml(inboundMessage.phone)}</code>` : undefined,
      "",
      escapeHtml(truncateText(inboundMessage.text, 600))
    );

    await Promise.all(
      users.map((user) =>
        this.telegram.sendMessage({
          chat_id: user.telegram_user_id,
          parse_mode: "HTML",
          text,
          reply_markup: inlineKeyboard([
            [
              inlineButton("Ответить", {
                callback_data: `inbox:reply:${inboundMessage.id}`
              }),
              inlineButton("Создать лид", {
                callback_data: `inbox:create_lead:${inboundMessage.id}`
              }),
              inlineButton("Игнорировать", {
                callback_data: `inbox:ignore:${inboundMessage.id}`
              })
            ]
          ])
        })
      )
    );
  }

  async createLeadFromInboundMessage(user, chatId, inboundMessage, sourceMessage = null) {
    if (!inboundMessage.phone_normalized) {
      this.sessions.set(
        user.telegram_user_id,
        withSourceMessage(
          {
            type: "add_lead",
            step: "phone",
            draft: {
              name: inboundMessage.full_name,
              comment: inboundMessage.text,
              sourceType: SOURCE_TYPE.TELEGRAM,
              sourceLabel: "Telegram bot",
              inboundMessageId: inboundMessage.id
            }
          },
          sourceMessage
        )
      );

      await this.sendSessionPrompt(
        chatId,
        lines(
          "Создаем лид из сообщения Telegram.",
          `Клиент: ${inboundMessage.full_name}`,
          "",
          truncateText(inboundMessage.text, 300),
          "",
          "В сообщении нет телефона. Введите телефон клиента."
        ),
        sourceMessage,
        {
          backCallbackData: `messages:open:${inboundMessage.id}`,
          backText: "Назад к сообщению"
        }
      );
      return;
    }

    const blacklistEntry = this.db.getBlacklistByPhone(inboundMessage.phone_normalized);
    if (blacklistEntry) {
      await this.showBlacklistCard(chatId, blacklistEntry, sourceMessage);
      return;
    }

    const activeLead = this.db.findActiveLeadByPhone(inboundMessage.phone_normalized);
    if (activeLead) {
      this.db.createLeadHistory({
        leadId: activeLead.id,
        actorUserId: user.id,
        eventType: "telegram_message",
        eventText: `Новое сообщение из Telegram: ${inboundMessage.text}`
      });
      this.db.markInboundMessageLeadCreated(inboundMessage.id, activeLead.id);
      await this.showLeadCard(user, chatId, activeLead, sourceMessage);
      return;
    }

    const lead = this.db.createLead({
      creatorUserId: user.id,
      name: inboundMessage.full_name,
      phone: inboundMessage.phone,
      phoneNormalized: inboundMessage.phone_normalized,
      comment: inboundMessage.text,
      sourceType: SOURCE_TYPE.TELEGRAM,
      sourceLabel: "Telegram bot",
      status: LEAD_STATUS.NEW
    });

    this.db.createLeadHistory({
      leadId: lead.id,
      actorUserId: user.id,
      eventType: "created",
      eventText: "Лид создан из сообщения в Telegram"
    });
    this.db.markInboundMessageLeadCreated(inboundMessage.id, lead.id);

    await this.showLeadCard(user, chatId, lead, sourceMessage);
  }

  async notifyOwnerAboutAccessRequest(request) {
    const owner = this.db.getUserByTelegramId(this.config.owner.telegramId);
    if (!owner) {
      return;
    }

    await this.telegram.sendMessage({
      chat_id: owner.telegram_user_id,
      parse_mode: "HTML",
      text: lines(
        "<b>Новый запрос на доступ</b>",
        `Имя: ${escapeHtml(request.full_name)}`,
        `Username: ${escapeHtml(request.username ? `@${request.username}` : "—")}`,
        `Telegram ID: <code>${escapeHtml(String(request.telegram_user_id))}</code>`
      ),
      reply_markup: inlineKeyboard([
        [
          inlineButton("Одобрить", { callback_data: `access:approve:${request.id}` }),
          inlineButton("Отклонить", { callback_data: `access:reject:${request.id}` })
        ]
      ])
    });
  }

  async handleCreateLeadFromBlacklist(user, chatId, phoneNormalized, sourceMessage = null) {
    const blacklistEntry = this.db.getBlacklistByPhone(phoneNormalized);
    if (!blacklistEntry) {
      await this.sendInlineScreen(chatId, { text: "Запись в черном списке не найдена." }, sourceMessage);
      return;
    }

    this.sessions.set(
      user.telegram_user_id,
      withSourceMessage(
        {
          type: "add_lead",
          step: "name",
          draft: {
            phone: blacklistEntry.phone,
            phoneNormalized,
            createFromBlacklist: true
          }
        },
        sourceMessage
      )
    );

    await this.sendSessionPrompt(
      chatId,
      "Создаем лида из номера в ЧС. Он будет убран из черного списка после успешного создания лида. Введите имя клиента или свою пометку.",
      sourceMessage,
      {
        backCallbackData: `blacklist:view:${phoneNormalized}`,
        backText: "Назад к ЧС"
      }
    );
  }

  async handleBlacklistAddReason(user, chatId, reasonIndexRaw) {
    const session = this.sessions.get(user.telegram_user_id);
    if (!session || session.type !== "blacklist_add") {
      await this.telegram.sendMessage({
        chat_id: chatId,
        text: "Сценарий добавления в ЧС уже завершен."
      });
      return;
    }

    const reasonIndex = parseZeroBasedIndex(reasonIndexRaw);
    const reason = BLACKLIST_REASON_OPTIONS[reasonIndex ?? 0] ?? BLACKLIST_REASON_OPTIONS[0];

    this.sessions.set(user.telegram_user_id, {
      type: "blacklist_add",
      step: "comment",
      draft: {
        ...session.draft,
        reason
      },
      sourceMessageId: session.sourceMessageId
    });

    await this.sendSessionPrompt(
      chatId,
      "Введите комментарий для ЧС или `-`, чтобы пропустить.",
      getSessionSourceMessage(chatId, session),
      {
        backCallbackData: "blacklist:show",
        backText: "Назад к ЧС"
      }
    );
  }

  async handleLeadBlacklistCommentSession(user, chatId, text, session) {
    const lead = this.db.getLeadById(session.leadId);
    if (!lead) {
      this.sessions.clear(user.telegram_user_id);
      await this.sendInlineScreen(chatId, { text: "Лид не найден." }, getSessionSourceMessage(chatId, session));
      return;
    }

    const comment = text === "-" ? null : text;
    const entry = this.db.addBlacklistEntry({
      phone: lead.phone,
      phoneNormalized: lead.phone_normalized,
      nameLabel: lead.name,
      reason: session.reason,
      comment,
      actorUserId: user.id
    });

    this.db.createLeadHistory({
      leadId: lead.id,
      actorUserId: user.id,
      eventType: "blacklist",
      eventText: comment
        ? `Номер добавлен в черный список. Причина: ${session.reason}. Комментарий: ${comment}`
        : `Номер добавлен в черный список. Причина: ${session.reason}`
    });

    this.sessions.clear(user.telegram_user_id);
    await this.showBlacklistCard(chatId, entry, getSessionSourceMessage(chatId, session));
  }

  renderLeadCardText(lead, timeZone) {
    const nextContact = lead.next_contact_at
      ? formatFullDateTime(new Date(lead.next_contact_at), timeZone)
      : "—";

    return lines(
      `<b>${escapeHtml(lead.name)}</b>`,
      `Телефон: <code>${escapeHtml(lead.phone)}</code>`,
      `Авто: ${escapeHtml(textOrDash(lead.car))}`,
      `Услуга: ${escapeHtml(textOrDash(lead.service))}`,
      `Статус: <b>${escapeHtml(LEAD_STATUS_LABELS[lead.status] ?? lead.status)}</b>`,
      `Температура: ${escapeHtml(lead.temperature ? LEAD_TEMPERATURE_LABELS[lead.temperature] : "—")}`,
      `Поступил: ${escapeHtml(formatFullDateTime(new Date(lead.received_at), timeZone))}`,
      `Следующий контакт: ${escapeHtml(nextContact)}`,
      `Источник: ${escapeHtml(lead.source_label)}`,
      `Комментарий: ${escapeHtml(textOrDash(lead.comment))}`
    );
  }

  renderAppointmentCardText(appointment, timeZone) {
    return lines(
      `<b>${escapeHtml(appointment.lead_name)}</b>`,
      `Телефон: <code>${escapeHtml(appointment.lead_phone)}</code>`,
      `Дата и время: ${escapeHtml(formatFullDateTime(new Date(appointment.appointment_at), timeZone))}`,
      `Услуга: ${escapeHtml(appointment.service)}`,
      `Статус записи: <b>${escapeHtml(APPOINTMENT_STATUS_LABELS[appointment.status] ?? appointment.status)}</b>`,
      `Авто: ${escapeHtml(textOrDash(appointment.car))}`,
      `Комментарий: ${escapeHtml(textOrDash(appointment.comment))}`,
      `Ожидаемая сумма: ${escapeHtml(textOrDash(appointment.expected_amount))}`,
      `Длительность: ${escapeHtml(textOrDash(appointment.duration_minutes))}`
    );
  }

  renderNewLeadNotification(lead, timeZone) {
    return lines(
      "<b>Новая заявка</b>",
      "",
      `Имя: ${escapeHtml(lead.name)}`,
      `Телефон: <code>${escapeHtml(lead.phone)}</code>`,
      `Услуга: ${escapeHtml(textOrDash(lead.service))}`,
      `Комментарий: ${escapeHtml(textOrDash(lead.comment))}`,
      `Источник: ${escapeHtml(lead.source_label)}`,
      `Поступил: ${escapeHtml(formatFullDateTime(new Date(lead.received_at), timeZone))}`
    );
  }

  getDayRange(timeZone, day) {
    const dayOffset = day === "tomorrow" ? 1 : 0;
    const start = getLocalDayStart(new Date(), timeZone, dayOffset);
    const end = getLocalDayStart(new Date(), timeZone, dayOffset + 1);
    return { start, end };
  }

  async getMainMenuCounts(user) {
    const rangeContext = getRangeContext(user.timezone);
    const dashboard = this.db.getDashboardCounts(rangeContext);
    return {
      ...dashboard,
      inWorkCount: this.db.listLeadsForSection("in_work", { now: rangeContext.nowIsoValue }).length,
      blacklistCount: this.db.listBlacklist().length,
      newInboundMessages: this.db.countNewInboundMessages()
    };
  }

  getLatestLeadIdByPhone(phoneNormalized) {
    const lead = this.db.getLatestLeadByPhone(phoneNormalized);
    return lead?.id ?? 0;
  }
}
