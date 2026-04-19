const DATE_TIME_INPUT_PATTERN =
  /^(?<day>\d{2})\.(?<month>\d{2})\.(?<year>\d{4}) (?<hour>\d{2}):(?<minute>\d{2})$/;
const TIME_INPUT_PATTERN = /^(?<hour>\d{2}):(?<minute>\d{2})$/;
const SEARCH_WINDOW_MINUTES = 18 * 60;

export const DEFAULT_TIME_ZONE = "Europe/Moscow";

const zonedPartsFormatterCache = new Map();

function getZonedPartsFormatter(timeZone) {
  validateTimeZone(timeZone);

  if (!zonedPartsFormatterCache.has(timeZone)) {
    zonedPartsFormatterCache.set(
      timeZone,
      new Intl.DateTimeFormat("en-GB", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }),
    );
  }

  return zonedPartsFormatterCache.get(timeZone);
}

function assertDateInstance(date, label = "date") {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError(`${label} must be a valid Date instance.`);
  }
}

function toInteger(value, label) {
  const integer = Number.parseInt(value, 10);

  if (!Number.isInteger(integer)) {
    throw new RangeError(`${label} must be an integer.`);
  }

  return integer;
}

function buildLocalIsoDate({ year, month, day }) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function buildUtcStampFromLocalParts(parts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
    0,
  );
}

function parseFormatterParts(parts) {
  const parsed = {};

  for (const part of parts) {
    if (part.type === "literal") {
      continue;
    }

    parsed[part.type] = toInteger(part.value, part.type);
  }

  return {
    year: parsed.year,
    month: parsed.month,
    day: parsed.day,
    hour: parsed.hour ?? 0,
    minute: parsed.minute ?? 0,
    second: parsed.second ?? 0,
  };
}

function isValidCalendarDate(year, month, day) {
  const candidate = new Date(Date.UTC(year, month - 1, day));

  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() + 1 === month &&
    candidate.getUTCDate() === day
  );
}

function validateLocalDateTimeParts(parts) {
  const { year, month, day, hour, minute } = parts;

  if (!isValidCalendarDate(year, month, day)) {
    throw new RangeError("Date must exist in the calendar.");
  }

  if (hour < 0 || hour > 23) {
    throw new RangeError("Hour must be between 00 and 23.");
  }

  if (minute < 0 || minute > 59) {
    throw new RangeError("Minute must be between 00 and 59.");
  }
}

function localDateTimePartsMatch(parts, targetParts) {
  return (
    parts.year === targetParts.year &&
    parts.month === targetParts.month &&
    parts.day === targetParts.day &&
    parts.hour === targetParts.hour &&
    parts.minute === targetParts.minute
  );
}

function findMatchingInstant(targetParts, timeZone) {
  const naiveUtcStamp = buildUtcStampFromLocalParts(targetParts);
  const estimate = new Date(naiveUtcStamp);
  const offsetMinutes = getTimeZoneOffsetMinutes(estimate, timeZone);
  const firstCandidateStamp = naiveUtcStamp - offsetMinutes * 60_000;
  const visited = new Set();
  const candidateStamps = [firstCandidateStamp, naiveUtcStamp];

  for (const stamp of candidateStamps) {
    if (visited.has(stamp)) {
      continue;
    }

    visited.add(stamp);
    const parts = getZonedDateTimeParts(new Date(stamp), timeZone);

    if (localDateTimePartsMatch(parts, targetParts)) {
      return new Date(stamp);
    }
  }

  // A bounded minute-by-minute search lets us reject nonexistent local times
  // and consistently pick the earliest matching instant for ambiguous DST times.
  for (let minuteShift = -SEARCH_WINDOW_MINUTES; minuteShift <= SEARCH_WINDOW_MINUTES; minuteShift += 1) {
    const stamp = firstCandidateStamp + minuteShift * 60_000;

    if (visited.has(stamp)) {
      continue;
    }

    visited.add(stamp);
    const parts = getZonedDateTimeParts(new Date(stamp), timeZone);

    if (localDateTimePartsMatch(parts, targetParts)) {
      return new Date(stamp);
    }
  }

  return null;
}

function ensureTimeZone(timeZone = DEFAULT_TIME_ZONE) {
  return validateTimeZone(timeZone);
}

export function validateTimeZone(timeZone = DEFAULT_TIME_ZONE) {
  if (typeof timeZone !== "string" || !timeZone.trim()) {
    throw new TypeError("timeZone must be a non-empty string.");
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch (error) {
    throw new RangeError(`Invalid IANA time zone: ${timeZone}`);
  }

  return timeZone;
}

export function parseDailyTime(input) {
  if (typeof input !== "string") {
    throw new TypeError("Daily time must be a string.");
  }

  const match = input.match(TIME_INPUT_PATTERN);

  if (!match?.groups) {
    throw new RangeError("Daily time must use strict HH:MM format.");
  }

  const hour = toInteger(match.groups.hour, "hour");
  const minute = toInteger(match.groups.minute, "minute");

  if (hour < 0 || hour > 23) {
    throw new RangeError("Hour must be between 00 and 23.");
  }

  if (minute < 0 || minute > 59) {
    throw new RangeError("Minute must be between 00 and 59.");
  }

  return {
    hour,
    minute,
    totalMinutes: hour * 60 + minute,
    input: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

export function getZonedDateTimeParts(date, timeZone = DEFAULT_TIME_ZONE) {
  assertDateInstance(date);
  const formatter = getZonedPartsFormatter(ensureTimeZone(timeZone));

  return parseFormatterParts(formatter.formatToParts(date));
}

export function getTimeZoneOffsetMinutes(date, timeZone = DEFAULT_TIME_ZONE) {
  assertDateInstance(date);
  const parts = getZonedDateTimeParts(date, timeZone);
  const zonedUtcStamp = buildUtcStampFromLocalParts(parts);

  return Math.round((zonedUtcStamp - date.getTime()) / 60_000);
}

export function parseStrictDateTime(input, timeZone = DEFAULT_TIME_ZONE) {
  if (typeof input !== "string") {
    throw new TypeError("Date/time input must be a string.");
  }

  ensureTimeZone(timeZone);
  const match = input.match(DATE_TIME_INPUT_PATTERN);

  if (!match?.groups) {
    throw new RangeError("Date/time must use strict DD.MM.YYYY HH:MM format.");
  }

  const parts = {
    day: toInteger(match.groups.day, "day"),
    month: toInteger(match.groups.month, "month"),
    year: toInteger(match.groups.year, "year"),
    hour: toInteger(match.groups.hour, "hour"),
    minute: toInteger(match.groups.minute, "minute"),
  };

  validateLocalDateTimeParts(parts);
  const instant = findMatchingInstant(parts, timeZone);

  if (!instant) {
    throw new RangeError(
      `Local date/time "${input}" does not exist in time zone "${timeZone}".`,
    );
  }

  return instant;
}

export function getLocalDateKey(date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = getZonedDateTimeParts(date, timeZone);

  return buildLocalIsoDate(parts);
}

export function getLocalDayNumber(date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = getZonedDateTimeParts(date, timeZone);

  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

export function getMinutesSinceLocalMidnight(date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = getZonedDateTimeParts(date, timeZone);

  return parts.hour * 60 + parts.minute;
}

export function getLocalTimeLabel(date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = getZonedDateTimeParts(date, timeZone);

  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function formatLeadDate(date, timeZone = DEFAULT_TIME_ZONE, options = {}) {
  const { includeYear = false } = options;
  const parts = getZonedDateTimeParts(date, timeZone);
  const dateLabel = includeYear
    ? `${String(parts.day).padStart(2, "0")}.${String(parts.month).padStart(2, "0")}.${String(parts.year).padStart(4, "0")}`
    : `${String(parts.day).padStart(2, "0")}.${String(parts.month).padStart(2, "0")}`;

  return `${dateLabel} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function formatFullDateTime(date, timeZone = DEFAULT_TIME_ZONE) {
  return formatLeadDate(date, timeZone, { includeYear: true });
}

export function getDayBucket(targetDate, timeZone = DEFAULT_TIME_ZONE, referenceDate = new Date()) {
  assertDateInstance(targetDate, "targetDate");
  assertDateInstance(referenceDate, "referenceDate");

  const delta = getLocalDayNumber(targetDate, timeZone) - getLocalDayNumber(referenceDate, timeZone);

  if (delta < 0) {
    return "overdue";
  }

  if (delta === 0) {
    return "today";
  }

  if (delta === 1) {
    return "tomorrow";
  }

  return "future";
}

export function isOverdue(targetDate, referenceDate = new Date()) {
  assertDateInstance(targetDate, "targetDate");
  assertDateInstance(referenceDate, "referenceDate");

  return targetDate.getTime() < referenceDate.getTime();
}

export function getDayBucketState(
  targetDate,
  timeZone = DEFAULT_TIME_ZONE,
  referenceDate = new Date(),
) {
  const bucket = getDayBucket(targetDate, timeZone, referenceDate);

  return {
    bucket,
    localDateKey: getLocalDateKey(targetDate, timeZone),
    timeLabel: getLocalTimeLabel(targetDate, timeZone),
    isToday: bucket === "today",
    isTomorrow: bucket === "tomorrow",
    isOverdue: isOverdue(targetDate, referenceDate),
  };
}

export function hasDailyTimePassed(
  date,
  dailyTime,
  timeZone = DEFAULT_TIME_ZONE,
) {
  assertDateInstance(date);
  const parsedTime = typeof dailyTime === "string" ? parseDailyTime(dailyTime) : dailyTime;

  return getMinutesSinceLocalMidnight(date, timeZone) >= parsedTime.totalMinutes;
}

export function buildLocalDateTimeFromParts(parts, timeZone = DEFAULT_TIME_ZONE) {
  validateLocalDateTimeParts(parts);
  const instant = findMatchingInstant(parts, timeZone);

  if (!instant) {
    throw new RangeError("Local date/time does not exist in the supplied time zone.");
  }

  return instant;
}

export function getLocalDateLabel(date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = getZonedDateTimeParts(date, timeZone);

  return `${String(parts.day).padStart(2, "0")}.${String(parts.month).padStart(2, "0")}.${String(parts.year).padStart(4, "0")}`;
}

export function addLocalDays(date, dayOffset, timeZone = DEFAULT_TIME_ZONE) {
  assertDateInstance(date);

  if (!Number.isInteger(dayOffset)) {
    throw new RangeError("dayOffset must be an integer.");
  }

  const parts = getZonedDateTimeParts(date, timeZone);
  const shiftedDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset));

  return {
    year: shiftedDate.getUTCFullYear(),
    month: shiftedDate.getUTCMonth() + 1,
    day: shiftedDate.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
  };
}
