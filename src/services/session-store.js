export class SessionStore {
  constructor() {
    this.sessions = new Map();
  }

  get(telegramUserId) {
    return this.sessions.get(telegramUserId) ?? null;
  }

  set(telegramUserId, session) {
    this.sessions.set(telegramUserId, {
      ...session,
      updatedAt: Date.now()
    });
  }

  clear(telegramUserId) {
    this.sessions.delete(telegramUserId);
  }
}
