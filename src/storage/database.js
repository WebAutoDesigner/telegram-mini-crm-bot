import { DatabaseSync } from "node:sqlite";

import {
  ACCESS_REQUEST_STATUS,
  ACTIVE_APPOINTMENT_STATUSES,
  ACTIVE_LEAD_STATUSES,
  APPOINTMENT_STATUS,
  FOLLOW_UP_LEAD_STATUSES,
  LEAD_STATUS,
  ROLES,
  SOURCE_TYPE
} from "../domain/constants.js";

function nowIso() {
  return new Date().toISOString();
}

function toDbBoolean(value) {
  return value ? 1 : 0;
}

function fromDbBoolean(value) {
  return Boolean(value);
}

function parseJson(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapUser(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    is_active: fromDbBoolean(row.is_active),
    summary_enabled: fromDbBoolean(row.summary_enabled)
  };
}

function mapBlacklist(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    is_active: fromDbBoolean(row.is_active)
  };
}

function mapHistoryRows(rows) {
  return rows.map((row) => ({
    ...row,
    meta_json: parseJson(row.meta_json)
  }));
}

export class AppDatabase {
  constructor(databasePath, config) {
    this.databasePath = databasePath;
    this.config = config;
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
  }

  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_user_id INTEGER NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        username TEXT,
        role TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        timezone TEXT NOT NULL,
        summary_enabled INTEGER NOT NULL DEFAULT 1,
        summary_time TEXT NOT NULL,
        last_summary_sent_local_date TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS access_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_user_id INTEGER NOT NULL,
        full_name TEXT NOT NULL,
        username TEXT,
        status TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by_user_id INTEGER,
        UNIQUE (telegram_user_id, status)
      );

      CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        creator_user_id INTEGER,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        phone_normalized TEXT NOT NULL,
        car TEXT,
        service TEXT,
        comment TEXT,
        source_type TEXT NOT NULL,
        source_label TEXT NOT NULL,
        status TEXT NOT NULL,
        temperature TEXT,
        next_contact_at TEXT,
        received_at TEXT NOT NULL,
        lost_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_by_user_id INTEGER
      );

      CREATE TABLE IF NOT EXISTS lead_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id INTEGER NOT NULL,
        actor_user_id INTEGER,
        event_type TEXT NOT NULL,
        event_text TEXT NOT NULL,
        meta_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id INTEGER NOT NULL,
        service TEXT NOT NULL,
        car TEXT,
        comment TEXT,
        expected_amount REAL,
        duration_minutes INTEGER,
        appointment_at TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS appointment_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        appointment_id INTEGER NOT NULL,
        actor_user_id INTEGER,
        event_type TEXT NOT NULL,
        event_text TEXT NOT NULL,
        meta_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS blacklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL,
        phone_normalized TEXT NOT NULL UNIQUE,
        name_label TEXT,
        reason TEXT NOT NULL,
        comment TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        removed_at TEXT,
        removed_by_user_id INTEGER
      );

      CREATE TABLE IF NOT EXISTS inbound_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_user_id INTEGER NOT NULL,
        full_name TEXT NOT NULL,
        username TEXT,
        text TEXT NOT NULL,
        phone TEXT,
        phone_normalized TEXT,
        status TEXT NOT NULL,
        lead_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inbound_message_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inbound_message_id INTEGER NOT NULL,
        actor_user_id INTEGER,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (inbound_message_id) REFERENCES inbound_messages(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_leads_phone_normalized ON leads(phone_normalized);
      CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
      CREATE INDEX IF NOT EXISTS idx_leads_next_contact_at ON leads(next_contact_at);
      CREATE INDEX IF NOT EXISTS idx_leads_received_at ON leads(received_at);
      CREATE INDEX IF NOT EXISTS idx_appointments_appointment_at ON appointments(appointment_at);
      CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
      CREATE INDEX IF NOT EXISTS idx_blacklist_active ON blacklist(is_active);
      CREATE INDEX IF NOT EXISTS idx_inbound_messages_status ON inbound_messages(status);
      CREATE INDEX IF NOT EXISTS idx_inbound_messages_telegram_user_id ON inbound_messages(telegram_user_id);
      CREATE INDEX IF NOT EXISTS idx_inbound_message_replies_message ON inbound_message_replies(inbound_message_id);
    `);
  }

  close() {
    this.db.close();
  }

  seedOwner() {
    const existingOwner = this.getUserByTelegramId(this.config.owner.telegramId);
    const timestamp = nowIso();

    if (existingOwner) {
      this.db
        .prepare(`
          UPDATE users
          SET full_name = ?, username = ?, role = ?, is_active = 1, updated_at = ?
          WHERE telegram_user_id = ?
        `)
        .run(
          this.config.owner.fullName,
          this.config.owner.username,
          ROLES.OWNER,
          timestamp,
          this.config.owner.telegramId
        );

      return this.getUserByTelegramId(this.config.owner.telegramId);
    }

    this.db
      .prepare(`
        INSERT INTO users (
          telegram_user_id,
          full_name,
          username,
          role,
          is_active,
          timezone,
          summary_enabled,
          summary_time,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, 1, ?, ?, ?)
      `)
      .run(
        this.config.owner.telegramId,
        this.config.owner.fullName,
        this.config.owner.username,
        ROLES.OWNER,
        this.config.defaultTimeZone,
        this.config.defaultSummaryTime,
        timestamp,
        timestamp
      );

    return this.getUserByTelegramId(this.config.owner.telegramId);
  }

  getUserByTelegramId(telegramUserId) {
    const row = this.db
      .prepare("SELECT * FROM users WHERE telegram_user_id = ? LIMIT 1")
      .get(telegramUserId);

    return mapUser(row);
  }

  getUserById(id) {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(id);
    return mapUser(row);
  }

  listActiveUsers() {
    const rows = this.db
      .prepare("SELECT * FROM users WHERE is_active = 1 ORDER BY role ASC, id ASC")
      .all();

    return rows.map(mapUser);
  }

  listEmployees() {
    const rows = this.db
      .prepare("SELECT * FROM users WHERE is_active = 1 AND role = ? ORDER BY id ASC")
      .all(ROLES.EMPLOYEE);

    return rows.map(mapUser);
  }

  updateUserSettings(userId, updates) {
    const current = this.getUserById(userId);
    if (!current) {
      return null;
    }

    const next = {
      timezone: updates.timezone ?? current.timezone,
      summary_enabled:
        typeof updates.summary_enabled === "boolean"
          ? updates.summary_enabled
          : current.summary_enabled,
      summary_time: updates.summary_time ?? current.summary_time
    };

    this.db
      .prepare(`
        UPDATE users
        SET timezone = ?, summary_enabled = ?, summary_time = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        next.timezone,
        toDbBoolean(next.summary_enabled),
        next.summary_time,
        nowIso(),
        userId
      );

    return this.getUserById(userId);
  }

  markSummarySent(userId, localDate) {
    this.db
      .prepare(`
        UPDATE users
        SET last_summary_sent_local_date = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(localDate, nowIso(), userId);
  }

  createOrRefreshAccessRequest({ telegramUserId, fullName, username }) {
    const existingUser = this.getUserByTelegramId(telegramUserId);
    if (existingUser && existingUser.is_active) {
      return { type: "already_active", user: existingUser };
    }

    const existingPending = this.db
      .prepare(`
        SELECT * FROM access_requests
        WHERE telegram_user_id = ? AND status = ?
        LIMIT 1
      `)
      .get(telegramUserId, ACCESS_REQUEST_STATUS.PENDING);

    const timestamp = nowIso();

    if (existingPending) {
      this.db
        .prepare(`
          UPDATE access_requests
          SET full_name = ?, username = ?, requested_at = ?
          WHERE id = ?
        `)
        .run(fullName, username ?? null, timestamp, existingPending.id);

      return {
        type: "pending_existing",
        request: this.getAccessRequestById(existingPending.id)
      };
    }

    const result = this.db
      .prepare(`
        INSERT INTO access_requests (
          telegram_user_id,
          full_name,
          username,
          status,
          requested_at
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        telegramUserId,
        fullName,
        username ?? null,
        ACCESS_REQUEST_STATUS.PENDING,
        timestamp
      );

    return {
      type: "pending_created",
      request: this.getAccessRequestById(result.lastInsertRowid)
    };
  }

  getAccessRequestById(id) {
    return (
      this.db.prepare("SELECT * FROM access_requests WHERE id = ? LIMIT 1").get(id) ?? null
    );
  }

  listPendingAccessRequests() {
    return this.db
      .prepare(`
        SELECT * FROM access_requests
        WHERE status = ?
        ORDER BY requested_at ASC
      `)
      .all(ACCESS_REQUEST_STATUS.PENDING);
  }

  approveAccessRequest(requestId, resolverUserId) {
    const request = this.getAccessRequestById(requestId);
    if (!request || request.status !== ACCESS_REQUEST_STATUS.PENDING) {
      return null;
    }

    const timestamp = nowIso();
    const existingUser = this.getUserByTelegramId(request.telegram_user_id);

    if (existingUser) {
      this.db
        .prepare(`
          UPDATE users
          SET full_name = ?, username = ?, is_active = 1, updated_at = ?
          WHERE telegram_user_id = ?
        `)
        .run(request.full_name, request.username, timestamp, request.telegram_user_id);
    } else {
      this.db
        .prepare(`
          INSERT INTO users (
            telegram_user_id,
            full_name,
            username,
            role,
            is_active,
            timezone,
            summary_enabled,
            summary_time,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, 1, ?, 1, ?, ?, ?)
        `)
        .run(
          request.telegram_user_id,
          request.full_name,
          request.username,
          ROLES.EMPLOYEE,
          this.config.defaultTimeZone,
          this.config.defaultSummaryTime,
          timestamp,
          timestamp
        );
    }

    this.db
      .prepare(`
        UPDATE access_requests
        SET status = ?, resolved_at = ?, resolved_by_user_id = ?
        WHERE id = ?
      `)
      .run(ACCESS_REQUEST_STATUS.APPROVED, timestamp, resolverUserId, requestId);

    return this.getUserByTelegramId(request.telegram_user_id);
  }

  rejectAccessRequest(requestId, resolverUserId) {
    const request = this.getAccessRequestById(requestId);
    if (!request || request.status !== ACCESS_REQUEST_STATUS.PENDING) {
      return null;
    }

    this.db
      .prepare(`
        UPDATE access_requests
        SET status = ?, resolved_at = ?, resolved_by_user_id = ?
        WHERE id = ?
      `)
      .run(ACCESS_REQUEST_STATUS.REJECTED, nowIso(), resolverUserId, requestId);

    return this.getAccessRequestById(requestId);
  }

  revokeUserAccess(userId) {
    this.db
      .prepare(`
        UPDATE users
        SET is_active = 0, updated_at = ?
        WHERE id = ?
      `)
      .run(nowIso(), userId);

    return this.getUserById(userId);
  }

  createInboundMessage({
    telegramUserId,
    fullName,
    username = null,
    text,
    phone = null,
    phoneNormalized = null
  }) {
    const timestamp = nowIso();
    const result = this.db
      .prepare(`
        INSERT INTO inbound_messages (
          telegram_user_id,
          full_name,
          username,
          text,
          phone,
          phone_normalized,
          status,
          lead_id,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'new', NULL, ?, ?)
      `)
      .run(
        telegramUserId,
        fullName,
        username,
        text,
        phone,
        phoneNormalized,
        timestamp,
        timestamp
      );

    return this.getInboundMessageById(result.lastInsertRowid);
  }

  getInboundMessageById(id) {
    return this.db.prepare("SELECT * FROM inbound_messages WHERE id = ? LIMIT 1").get(id) ?? null;
  }

  listInboundMessagesByTelegramUserId(telegramUserId) {
    return this.db
      .prepare(`
        SELECT *
        FROM inbound_messages
        WHERE telegram_user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 10
      `)
      .all(telegramUserId);
  }

  markInboundMessageLeadCreated(id, leadId) {
    this.db
      .prepare(`
        UPDATE inbound_messages
        SET status = 'lead_created', lead_id = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(leadId, nowIso(), id);

    return this.getInboundMessageById(id);
  }

  ignoreInboundMessage(id) {
    this.db
      .prepare(`
        UPDATE inbound_messages
        SET status = 'ignored', updated_at = ?
        WHERE id = ?
      `)
      .run(nowIso(), id);

    return this.getInboundMessageById(id);
  }

  markInboundMessageReplied(id) {
    this.db
      .prepare(`
        UPDATE inbound_messages
        SET status = 'replied', updated_at = ?
        WHERE id = ?
      `)
      .run(nowIso(), id);

    return this.getInboundMessageById(id);
  }

  createInboundMessageReply({ inboundMessageId, actorUserId = null, text }) {
    const result = this.db
      .prepare(`
        INSERT INTO inbound_message_replies (
          inbound_message_id,
          actor_user_id,
          text,
          created_at
        ) VALUES (?, ?, ?, ?)
      `)
      .run(inboundMessageId, actorUserId, text, nowIso());

    return this.db
      .prepare("SELECT * FROM inbound_message_replies WHERE id = ? LIMIT 1")
      .get(result.lastInsertRowid);
  }

  listInboundMessageReplies(inboundMessageId) {
    return this.db
      .prepare(`
        SELECT r.*, u.full_name AS actor_name
        FROM inbound_message_replies r
        LEFT JOIN users u ON u.id = r.actor_user_id
        WHERE r.inbound_message_id = ?
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 10
      `)
      .all(inboundMessageId);
  }

  countNewInboundMessages() {
    return this.db
      .prepare("SELECT COUNT(*) AS count FROM inbound_messages WHERE status = 'new'")
      .get().count;
  }

  listInboundMessages(filter = "new") {
    const where = filter === "new" ? "WHERE status = 'new'" : "";
    return this.db
      .prepare(`
        SELECT *
        FROM inbound_messages
        ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT 50
      `)
      .all();
  }

  createLead({
    creatorUserId = null,
    name,
    phone,
    phoneNormalized,
    car = null,
    service = null,
    comment = null,
    sourceType,
    sourceLabel,
    status = LEAD_STATUS.NEW,
    temperature = null,
    nextContactAt = null,
    receivedAt = nowIso(),
    lostReason = null
  }) {
    const timestamp = nowIso();

    const result = this.db
      .prepare(`
        INSERT INTO leads (
          creator_user_id,
          name,
          phone,
          phone_normalized,
          car,
          service,
          comment,
          source_type,
          source_label,
          status,
          temperature,
          next_contact_at,
          received_at,
          lost_reason,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        creatorUserId,
        name,
        phone,
        phoneNormalized,
        car,
        service,
        comment,
        sourceType,
        sourceLabel,
        status,
        temperature,
        nextContactAt,
        receivedAt,
        lostReason,
        timestamp,
        timestamp
      );

    return this.getLeadById(result.lastInsertRowid);
  }

  getLeadById(id) {
    return this.db.prepare("SELECT * FROM leads WHERE id = ? LIMIT 1").get(id) ?? null;
  }

  getLatestLeadByPhone(phoneNormalized) {
    return (
      this.db
        .prepare(`
          SELECT * FROM leads
          WHERE phone_normalized = ?
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        `)
        .get(phoneNormalized) ?? null
    );
  }

  findActiveLeadByPhone(phoneNormalized) {
    const placeholders = ACTIVE_LEAD_STATUSES.map(() => "?").join(", ");
    return (
      this.db
        .prepare(`
          SELECT * FROM leads
          WHERE phone_normalized = ?
            AND deleted_at IS NULL
            AND status IN (${placeholders})
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        `)
        .get(phoneNormalized, ...ACTIVE_LEAD_STATUSES) ?? null
    );
  }

  listHistoricalLeadsByPhone(phoneNormalized) {
    return this.db
      .prepare(`
        SELECT * FROM leads
        WHERE phone_normalized = ?
        ORDER BY created_at DESC, id DESC
      `)
      .all(phoneNormalized);
  }

  updateLeadEditableFields(leadId, updates) {
    const current = this.getLeadById(leadId);
    if (!current) {
      return null;
    }

    const next = {
      name: updates.name ?? current.name,
      phone: updates.phone ?? current.phone,
      phone_normalized: updates.phoneNormalized ?? current.phone_normalized,
      car: updates.car ?? current.car,
      service: updates.service ?? current.service,
      comment: updates.comment ?? current.comment,
      source_type: updates.sourceType ?? current.source_type,
      source_label: updates.sourceLabel ?? current.source_label
    };

    this.db
      .prepare(`
        UPDATE leads
        SET name = ?,
            phone = ?,
            phone_normalized = ?,
            car = ?,
            service = ?,
            comment = ?,
            source_type = ?,
            source_label = ?,
            updated_at = ?
        WHERE id = ?
      `)
      .run(
        next.name,
        next.phone,
        next.phone_normalized,
        next.car,
        next.service,
        next.comment,
        next.source_type,
        next.source_label,
        nowIso(),
        leadId
      );

    return this.getLeadById(leadId);
  }

  changeLeadStatus({ leadId, status, nextContactAt = null, lostReason = null }) {
    this.db
      .prepare(`
        UPDATE leads
        SET status = ?, next_contact_at = ?, lost_reason = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(status, nextContactAt, lostReason, nowIso(), leadId);

    return this.getLeadById(leadId);
  }

  changeLeadTemperature(leadId, temperature) {
    this.db
      .prepare(`
        UPDATE leads
        SET temperature = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(temperature, nowIso(), leadId);

    return this.getLeadById(leadId);
  }

  updateLeadComment(leadId, comment) {
    this.db
      .prepare(`
        UPDATE leads
        SET comment = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(comment, nowIso(), leadId);

    return this.getLeadById(leadId);
  }

  deleteLead(leadId, actorUserId) {
    this.db
      .prepare(`
        UPDATE leads
        SET deleted_at = ?, deleted_by_user_id = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(nowIso(), actorUserId, nowIso(), leadId);

    return this.getLeadById(leadId);
  }

  createLeadHistory({ leadId, actorUserId = null, eventType, eventText, meta = null }) {
    const result = this.db
      .prepare(`
        INSERT INTO lead_history (
          lead_id,
          actor_user_id,
          event_type,
          event_text,
          meta_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        leadId,
        actorUserId,
        eventType,
        eventText,
        meta ? JSON.stringify(meta) : null,
        nowIso()
      );

    return this.db.prepare("SELECT * FROM lead_history WHERE id = ?").get(result.lastInsertRowid);
  }

  getLeadHistory(leadId) {
    const rows = this.db
      .prepare(`
        SELECT lh.*, u.full_name AS actor_name
        FROM lead_history lh
        LEFT JOIN users u ON u.id = lh.actor_user_id
        WHERE lh.lead_id = ?
        ORDER BY lh.created_at DESC, lh.id DESC
      `)
      .all(leadId);

    return mapHistoryRows(rows);
  }

  createAppointment({
    leadId,
    service,
    car = null,
    comment = null,
    expectedAmount = null,
    durationMinutes = null,
    appointmentAt,
    status = APPOINTMENT_STATUS.SCHEDULED
  }) {
    const timestamp = nowIso();
    const result = this.db
      .prepare(`
        INSERT INTO appointments (
          lead_id,
          service,
          car,
          comment,
          expected_amount,
          duration_minutes,
          appointment_at,
          status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        leadId,
        service,
        car,
        comment,
        expectedAmount,
        durationMinutes,
        appointmentAt,
        status,
        timestamp,
        timestamp
      );

    return this.getAppointmentById(result.lastInsertRowid);
  }

  getAppointmentById(id) {
    return (
      this.db
        .prepare(`
          SELECT a.*, l.name AS lead_name, l.phone AS lead_phone, l.phone_normalized
          FROM appointments a
          INNER JOIN leads l ON l.id = a.lead_id
          WHERE a.id = ?
          LIMIT 1
        `)
        .get(id) ?? null
    );
  }

  updateAppointmentStatus(appointmentId, status) {
    this.db
      .prepare(`
        UPDATE appointments
        SET status = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(status, nowIso(), appointmentId);

    return this.getAppointmentById(appointmentId);
  }

  rescheduleAppointment(appointmentId, appointmentAt) {
    this.db
      .prepare(`
        UPDATE appointments
        SET appointment_at = ?, status = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(appointmentAt, APPOINTMENT_STATUS.RESCHEDULED, nowIso(), appointmentId);

    return this.getAppointmentById(appointmentId);
  }

  updateAppointmentComment(appointmentId, comment) {
    this.db
      .prepare(`
        UPDATE appointments
        SET comment = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(comment, nowIso(), appointmentId);

    return this.getAppointmentById(appointmentId);
  }

  createAppointmentHistory({
    appointmentId,
    actorUserId = null,
    eventType,
    eventText,
    meta = null
  }) {
    const result = this.db
      .prepare(`
        INSERT INTO appointment_history (
          appointment_id,
          actor_user_id,
          event_type,
          event_text,
          meta_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        appointmentId,
        actorUserId,
        eventType,
        eventText,
        meta ? JSON.stringify(meta) : null,
        nowIso()
      );

    return this.db
      .prepare("SELECT * FROM appointment_history WHERE id = ?")
      .get(result.lastInsertRowid);
  }

  getAppointmentHistory(appointmentId) {
    const rows = this.db
      .prepare(`
        SELECT ah.*, u.full_name AS actor_name
        FROM appointment_history ah
        LEFT JOIN users u ON u.id = ah.actor_user_id
        WHERE ah.appointment_id = ?
        ORDER BY ah.created_at DESC, ah.id DESC
      `)
      .all(appointmentId);

    return mapHistoryRows(rows);
  }

  addBlacklistEntry({
    phone,
    phoneNormalized,
    nameLabel = null,
    reason,
    comment = null,
    actorUserId = null
  }) {
    const timestamp = nowIso();

    this.db
      .prepare(`
        INSERT INTO blacklist (
          phone,
          phone_normalized,
          name_label,
          reason,
          comment,
          is_active,
          created_at,
          updated_at,
          removed_at,
          removed_by_user_id
        )
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, NULL, NULL)
        ON CONFLICT(phone_normalized) DO UPDATE SET
          phone = excluded.phone,
          name_label = excluded.name_label,
          reason = excluded.reason,
          comment = excluded.comment,
          is_active = 1,
          updated_at = excluded.updated_at,
          removed_at = NULL,
          removed_by_user_id = NULL
      `)
      .run(phone, phoneNormalized, nameLabel, reason, comment, timestamp, timestamp);

    if (actorUserId) {
      void actorUserId;
    }

    return this.getBlacklistByPhone(phoneNormalized);
  }

  getBlacklistByPhone(phoneNormalized) {
    const row = this.db
      .prepare(`
        SELECT * FROM blacklist
        WHERE phone_normalized = ? AND is_active = 1
        LIMIT 1
      `)
      .get(phoneNormalized);

    return mapBlacklist(row);
  }

  listBlacklist() {
    const rows = this.db
      .prepare(`
        SELECT * FROM blacklist
        WHERE is_active = 1
        ORDER BY updated_at DESC, id DESC
      `)
      .all();

    return rows.map(mapBlacklist);
  }

  removeBlacklist(phoneNormalized, actorUserId = null) {
    this.db
      .prepare(`
        UPDATE blacklist
        SET is_active = 0,
            updated_at = ?,
            removed_at = ?,
            removed_by_user_id = ?
        WHERE phone_normalized = ? AND is_active = 1
      `)
      .run(nowIso(), nowIso(), actorUserId, phoneNormalized);

    return this.db
      .prepare("SELECT * FROM blacklist WHERE phone_normalized = ? LIMIT 1")
      .get(phoneNormalized);
  }

  listLeadsForSection(section, { temperature = "all", now = nowIso() } = {}) {
    const conditions = ["deleted_at IS NULL"];
    const params = [];

    if (temperature !== "all") {
      conditions.push("temperature = ?");
      params.push(temperature);
    }

    if (section === "new") {
      conditions.push("status = ?");
      params.push(LEAD_STATUS.NEW);
    } else if (section === "in_work") {
      conditions.push("status IN (?, ?, ?, ?)");
      params.push(
        LEAD_STATUS.IN_PROGRESS,
        LEAD_STATUS.WAITING_DECISION,
        LEAD_STATUS.BOOKED,
        LEAD_STATUS.NO_ANSWER
      );
    } else if (section === "postponed") {
      conditions.push("status = ?");
      params.push(LEAD_STATUS.POSTPONED);
    } else if (section === "overdue") {
      const placeholders = FOLLOW_UP_LEAD_STATUSES.map(() => "?").join(", ");
      conditions.push(`status IN (${placeholders})`);
      params.push(...FOLLOW_UP_LEAD_STATUSES);
      conditions.push("next_contact_at IS NOT NULL");
      conditions.push("next_contact_at < ?");
      params.push(now);
    }

    const rows = this.db
      .prepare(`
        SELECT * FROM leads
        WHERE ${conditions.join(" AND ")}
        ORDER BY
          CASE WHEN next_contact_at IS NULL THEN 1 ELSE 0 END ASC,
          next_contact_at ASC,
          received_at DESC,
          id DESC
      `)
      .all(...params);

    return rows;
  }

  listLeadsByNextContactRange(startIso, endIso) {
    const rows = this.db
      .prepare(`
        SELECT * FROM leads
        WHERE deleted_at IS NULL
          AND next_contact_at IS NOT NULL
          AND status != ?
          AND next_contact_at >= ?
          AND next_contact_at < ?
        ORDER BY next_contact_at ASC, id DESC
      `)
      .all(LEAD_STATUS.LOST, startIso, endIso);

    return rows;
  }

  listAppointmentsByRange(startIso, endIso) {
    const placeholders = ACTIVE_APPOINTMENT_STATUSES.map(() => "?").join(", ");
    return this.db
      .prepare(`
        SELECT a.*, l.name AS lead_name, l.phone AS lead_phone, l.phone_normalized
        FROM appointments a
        INNER JOIN leads l ON l.id = a.lead_id
        WHERE a.appointment_at >= ?
          AND a.appointment_at < ?
          AND a.status IN (${placeholders})
        ORDER BY a.appointment_at ASC, a.id DESC
      `)
      .all(startIso, endIso, ...ACTIVE_APPOINTMENT_STATUSES);
  }

  getDashboardCounts({ nowIsoValue, todayStartIso, tomorrowStartIso, dayAfterTomorrowStartIso }) {
    const overdueContacts = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM leads
        WHERE deleted_at IS NULL
          AND status IN (?, ?, ?)
          AND next_contact_at IS NOT NULL
          AND next_contact_at < ?
      `)
      .get(
        LEAD_STATUS.WAITING_DECISION,
        LEAD_STATUS.NO_ANSWER,
        LEAD_STATUS.POSTPONED,
        nowIsoValue
      ).count;

    const newUnprocessed = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM leads
        WHERE deleted_at IS NULL
          AND status = ?
      `)
      .get(LEAD_STATUS.NEW).count;

    const todayContacts = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM leads
        WHERE deleted_at IS NULL
          AND next_contact_at IS NOT NULL
          AND next_contact_at >= ?
          AND next_contact_at < ?
      `)
      .get(todayStartIso, tomorrowStartIso).count;

    const tomorrowContacts = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM leads
        WHERE deleted_at IS NULL
          AND next_contact_at IS NOT NULL
          AND next_contact_at >= ?
          AND next_contact_at < ?
      `)
      .get(tomorrowStartIso, dayAfterTomorrowStartIso).count;

    const todayAppointments = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM appointments
        WHERE appointment_at >= ? AND appointment_at < ?
          AND status IN (?, ?, ?, ?)
      `)
      .get(todayStartIso, tomorrowStartIso, ...ACTIVE_APPOINTMENT_STATUSES).count;

    const tomorrowAppointments = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM appointments
        WHERE appointment_at >= ? AND appointment_at < ?
          AND status IN (?, ?, ?, ?)
      `)
      .get(tomorrowStartIso, dayAfterTomorrowStartIso, ...ACTIVE_APPOINTMENT_STATUSES).count;

    const postponed = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM leads
        WHERE deleted_at IS NULL
          AND status = ?
      `)
      .get(LEAD_STATUS.POSTPONED).count;

    return {
      overdueContacts,
      newUnprocessed,
      todayContacts,
      todayAppointments,
      tomorrowContacts,
      tomorrowAppointments,
      postponed
    };
  }

  searchLeads(query, filter = "all") {
    const wildcard = `%${query}%`;
    const conditions = ["deleted_at IS NULL"];
    const params = [];

    if (filter === "active") {
      const placeholders = ACTIVE_LEAD_STATUSES.map(() => "?").join(", ");
      conditions.push(`status IN (${placeholders})`);
      params.push(...ACTIVE_LEAD_STATUSES);
    } else if (filter === "lost") {
      conditions.push("status = ?");
      params.push(LEAD_STATUS.LOST);
    }

    conditions.push(`
      (
        name LIKE ? OR
        phone LIKE ? OR
        service LIKE ? OR
        comment LIKE ? OR
        car LIKE ?
      )
    `);
    params.push(wildcard, wildcard, wildcard, wildcard, wildcard);

    return this.db
      .prepare(`
        SELECT * FROM leads
        WHERE ${conditions.join(" AND ")}
        ORDER BY updated_at DESC, id DESC
        LIMIT 50
      `)
      .all(...params);
  }

  getClientTimeline(phoneNormalized) {
    const leadRows = this.db
      .prepare(`
        SELECT
          'lead' AS item_type,
          id,
          status,
          received_at AS happened_at,
          name,
          service,
          comment,
          lost_reason
        FROM leads
        WHERE phone_normalized = ?
        ORDER BY received_at DESC, id DESC
      `)
      .all(phoneNormalized);

    const appointmentRows = this.db
      .prepare(`
        SELECT
          'appointment' AS item_type,
          a.id,
          a.status,
          a.appointment_at AS happened_at,
          l.name,
          a.service,
          a.comment,
          NULL AS lost_reason
        FROM appointments a
        INNER JOIN leads l ON l.id = a.lead_id
        WHERE l.phone_normalized = ?
        ORDER BY a.appointment_at DESC, a.id DESC
      `)
      .all(phoneNormalized);

    return [...leadRows, ...appointmentRows].sort((left, right) =>
      right.happened_at.localeCompare(left.happened_at)
    );
  }

  createSiteLead(payload) {
    return this.createLead({
      name: payload.name || "Без имени",
      phone: payload.phone,
      phoneNormalized: payload.phoneNormalized,
      service: payload.service ?? null,
      comment: payload.comment ?? null,
      sourceType: SOURCE_TYPE.SITE,
      sourceLabel: "Сайт",
      status: LEAD_STATUS.NEW,
      receivedAt: nowIso()
    });
  }
}
