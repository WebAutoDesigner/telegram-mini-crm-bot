export const ROLES = {
  OWNER: "owner",
  EMPLOYEE: "employee"
};

export const LEAD_STATUS = {
  NEW: "new",
  IN_PROGRESS: "in_progress",
  WAITING_DECISION: "waiting_decision",
  BOOKED: "booked",
  NO_ANSWER: "no_answer",
  POSTPONED: "postponed",
  LOST: "lost"
};

export const APPOINTMENT_STATUS = {
  SCHEDULED: "scheduled",
  CONFIRMED: "confirmed",
  RESCHEDULED: "rescheduled",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  NO_SHOW: "no_show",
  CANCELED: "canceled"
};

export const LEAD_TEMPERATURE = {
  HOT: "hot",
  WARM: "warm",
  COLD: "cold"
};

export const SOURCE_TYPE = {
  SITE: "site",
  MANUAL: "manual",
  TELEGRAM: "telegram"
};

export const ACCESS_REQUEST_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected"
};

export const MAIN_MENU_LABELS = {
  NEW_LEADS: "Новые заявки",
  IN_WORK: "В работе",
  POSTPONED: "Отложенные",
  OVERDUE: "Просроченные",
  TODAY: "Сегодня",
  TOMORROW: "Завтра",
  ADD_LEAD: "Добавить лид",
  SEARCH: "Поиск",
  MESSAGES: "Сообщения",
  BLACKLIST: "Черный список",
  REMINDERS: "Напоминания",
  SETTINGS: "Настройки"
};

export const LEAD_RESULT_LABELS = {
  [LEAD_STATUS.IN_PROGRESS]: "В работе",
  [LEAD_STATUS.WAITING_DECISION]: "Ждет решения",
  [LEAD_STATUS.BOOKED]: "Записан",
  [LEAD_STATUS.NO_ANSWER]: "Не ответил",
  [LEAD_STATUS.POSTPONED]: "Отложен",
  [LEAD_STATUS.LOST]: "Потерян"
};

export const LEAD_STATUS_LABELS = {
  [LEAD_STATUS.NEW]: "Новая заявка",
  ...LEAD_RESULT_LABELS
};

export const LEAD_TEMPERATURE_LABELS = {
  [LEAD_TEMPERATURE.HOT]: "Горячий",
  [LEAD_TEMPERATURE.WARM]: "Теплый",
  [LEAD_TEMPERATURE.COLD]: "Холодный"
};

export const APPOINTMENT_STATUS_LABELS = {
  [APPOINTMENT_STATUS.SCHEDULED]: "Назначена",
  [APPOINTMENT_STATUS.CONFIRMED]: "Подтверждена",
  [APPOINTMENT_STATUS.RESCHEDULED]: "Перенесена",
  [APPOINTMENT_STATUS.IN_PROGRESS]: "В работе",
  [APPOINTMENT_STATUS.COMPLETED]: "Выполнена",
  [APPOINTMENT_STATUS.NO_SHOW]: "Не приехал",
  [APPOINTMENT_STATUS.CANCELED]: "Отменена"
};

export const ACTIVE_APPOINTMENT_STATUSES = [
  APPOINTMENT_STATUS.SCHEDULED,
  APPOINTMENT_STATUS.CONFIRMED,
  APPOINTMENT_STATUS.RESCHEDULED,
  APPOINTMENT_STATUS.IN_PROGRESS
];

export const BLACKLIST_REASON_OPTIONS = [
  "Спам",
  "Неадекват",
  "Нежелательный клиент",
  "Дубликат/мусор",
  "Другое"
];

export const LOST_REASON_OPTIONS = [
  "Дорого",
  "Не ответил",
  "Передумал",
  "Ушел к другим",
  "Неактуально",
  "Спам/мусор",
  "Другое"
];

export const FILTER_TEMPERATURES = [
  { value: "all", label: "Все" },
  { value: LEAD_TEMPERATURE.HOT, label: "Горячие" },
  { value: LEAD_TEMPERATURE.WARM, label: "Теплые" },
  { value: LEAD_TEMPERATURE.COLD, label: "Холодные" }
];

export const ACTIVE_LEAD_STATUSES = [
  LEAD_STATUS.NEW,
  LEAD_STATUS.IN_PROGRESS,
  LEAD_STATUS.WAITING_DECISION,
  LEAD_STATUS.BOOKED,
  LEAD_STATUS.NO_ANSWER,
  LEAD_STATUS.POSTPONED
];

export const FOLLOW_UP_LEAD_STATUSES = [
  LEAD_STATUS.WAITING_DECISION,
  LEAD_STATUS.NO_ANSWER,
  LEAD_STATUS.POSTPONED
];
