import {
  DEFAULT_TIME_ZONE,
  getLocalDateKey,
  hasDailyTimePassed,
  parseDailyTime,
  validateTimeZone,
} from "../utils/date-time.js";

const DEFAULT_POLL_INTERVAL_MS = 30_000;

function normalizeBoolean(value, fallback = true) {
  if (typeof value === "boolean") {
    return value;
  }

  return fallback;
}

function normalizeUserId(schedule) {
  const userId = schedule.userId ?? schedule.id;

  if (userId === undefined || userId === null || userId === "") {
    throw new TypeError("Daily summary schedule must include userId or id.");
  }

  return String(userId);
}

export function normalizeUserSummarySchedule(
  input,
  defaultTimeZone = DEFAULT_TIME_ZONE,
) {
  if (!input || typeof input !== "object") {
    throw new TypeError("User summary schedule must be an object.");
  }

  const timeZone = validateTimeZone(input.timeZone ?? defaultTimeZone);
  const parsedTime = parseDailyTime(
    input.dailySummaryTime ?? input.summaryTime ?? "10:00",
  );
  const localDate =
    input.lastTriggeredLocalDate ??
    input.lastTriggeredOn ??
    input.lastDailySummaryDate ??
    null;

  return {
    userId: normalizeUserId(input),
    timeZone,
    dailySummaryEnabled: normalizeBoolean(
      input.dailySummaryEnabled ?? input.summaryEnabled,
      true,
    ),
    dailySummaryTime: parsedTime.input,
    dailySummaryMinutes: parsedTime.totalMinutes,
    lastTriggeredLocalDate: typeof localDate === "string" && localDate ? localDate : null,
    lastTriggeredAt: input.lastTriggeredAt instanceof Date ? input.lastTriggeredAt : null,
    meta: input.meta ?? null,
    raw: input,
  };
}

export function isDailySummaryDue(
  schedule,
  now = new Date(),
  defaultTimeZone = DEFAULT_TIME_ZONE,
) {
  const normalized = schedule.dailySummaryMinutes !== undefined
    ? schedule
    : normalizeUserSummarySchedule(schedule, defaultTimeZone);

  if (!normalized.dailySummaryEnabled) {
    return false;
  }

  const localDateKey = getLocalDateKey(now, normalized.timeZone);

  if (normalized.lastTriggeredLocalDate === localDateKey) {
    return false;
  }

  return hasDailyTimePassed(now, normalized.dailySummaryTime, normalized.timeZone);
}

export class DailySummaryScheduler {
  constructor(options = {}) {
    const {
      onTrigger,
      defaultTimeZone = DEFAULT_TIME_ZONE,
      pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
      now = () => new Date(),
      onStateChange = null,
      onError = null,
    } = options;

    if (typeof onTrigger !== "function") {
      throw new TypeError("DailySummaryScheduler requires an onTrigger callback.");
    }

    if (!Number.isInteger(pollIntervalMs) || pollIntervalMs <= 0) {
      throw new RangeError("pollIntervalMs must be a positive integer.");
    }

    this.onTrigger = onTrigger;
    this.defaultTimeZone = validateTimeZone(defaultTimeZone);
    this.pollIntervalMs = pollIntervalMs;
    this.now = now;
    this.onStateChange = typeof onStateChange === "function" ? onStateChange : null;
    this.onError = typeof onError === "function" ? onError : null;
    this.users = new Map();
    this.timer = null;
    this.running = false;
    this.ticking = false;
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.scheduleNextTick(0);
  }

  stop() {
    this.running = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  isRunning() {
    return this.running;
  }

  syncUsers(userSchedules = []) {
    if (!Array.isArray(userSchedules)) {
      throw new TypeError("syncUsers expects an array of schedules.");
    }

    const nextUsers = new Map();

    for (const schedule of userSchedules) {
      const normalized = normalizeUserSummarySchedule(schedule, this.defaultTimeZone);
      nextUsers.set(normalized.userId, normalized);
    }

    this.users = nextUsers;
  }

  upsertUser(userSchedule) {
    const normalized = normalizeUserSummarySchedule(userSchedule, this.defaultTimeZone);
    const existing = this.users.get(normalized.userId);

    this.users.set(normalized.userId, {
      ...normalized,
      lastTriggeredLocalDate:
        normalized.lastTriggeredLocalDate ?? existing?.lastTriggeredLocalDate ?? null,
      lastTriggeredAt: normalized.lastTriggeredAt ?? existing?.lastTriggeredAt ?? null,
    });

    return this.getUser(normalized.userId);
  }

  removeUser(userId) {
    this.users.delete(String(userId));
  }

  getUser(userId) {
    const schedule = this.users.get(String(userId));

    if (!schedule) {
      return null;
    }

    return { ...schedule };
  }

  listUsers() {
    return Array.from(this.users.values(), (schedule) => ({ ...schedule }));
  }

  async tick(referenceNow = this.now()) {
    const now = referenceNow instanceof Date ? referenceNow : new Date(referenceNow);

    if (Number.isNaN(now.getTime())) {
      throw new TypeError("tick requires a valid current date.");
    }

    for (const schedule of this.users.values()) {
      if (!isDailySummaryDue(schedule, now, this.defaultTimeZone)) {
        continue;
      }

      // If the process wakes up after the target time, we still send the summary
      // once for the current local day and then lock it with lastTriggeredLocalDate.
      const localDateKey = getLocalDateKey(now, schedule.timeZone);
      const context = {
        now,
        localDateKey,
        timeZone: schedule.timeZone,
        dailySummaryTime: schedule.dailySummaryTime,
        userId: schedule.userId,
        schedule: { ...schedule },
      };

      try {
        await this.onTrigger(context);
        schedule.lastTriggeredLocalDate = localDateKey;
        schedule.lastTriggeredAt = now;

        if (this.onStateChange) {
          await this.onStateChange({
            userId: schedule.userId,
            lastTriggeredLocalDate: localDateKey,
            lastTriggeredAt: now,
            schedule: { ...schedule },
          });
        }
      } catch (error) {
        if (this.onError) {
          await this.onError(error, context);
          continue;
        }

        throw error;
      }
    }
  }

  scheduleNextTick(delayMs = this.pollIntervalMs) {
    if (!this.running) {
      return;
    }

    this.timer = setTimeout(() => {
      void this.runLoop();
    }, delayMs);
  }

  async runLoop() {
    if (!this.running) {
      return;
    }

    if (this.ticking) {
      this.scheduleNextTick();
      return;
    }

    this.ticking = true;

    try {
      await this.tick();
    } catch (error) {
      if (this.onError) {
        await this.onError(error, { scheduler: this });
      } else {
        throw error;
      }
    } finally {
      this.ticking = false;
      this.scheduleNextTick();
    }
  }
}
