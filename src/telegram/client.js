const DEFAULT_API_ROOT = "https://api.telegram.org";
const DEFAULT_TIMEOUT_MS = 10_000;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && value.constructor === Object;
}

function compactValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => compactValue(item))
      .filter((item) => item !== undefined);
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, compactValue(item)])
      .filter(([, item]) => item !== undefined);

    return Object.fromEntries(entries);
  }

  return value === undefined ? undefined : value;
}

function assertString(name, value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
}

function normalizeApiRoot(apiRoot) {
  assertString("apiRoot", apiRoot);
  return apiRoot.replace(/\/+$/, "");
}

function buildMethodUrl(apiRoot, token, method) {
  return `${apiRoot}/bot${token}/${method}`;
}

async function readResponsePayload(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return text ? { ok: false, description: text } : { ok: false };
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const signal = init?.signal;

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener(
        "abort",
        () => {
          controller.abort(signal.reason);
        },
        { once: true },
      );
    }
  }

  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          controller.abort(new Error(`Telegram API request timed out after ${timeoutMs}ms.`));
        }, timeoutMs)
      : null;

  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export class TelegramApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "TelegramApiError";
    this.method = details.method;
    this.status = details.status;
    this.description = details.description;
    this.errorCode = details.errorCode;
    this.parameters = details.parameters;
    this.cause = details.cause;
  }
}

export class TelegramApiClient {
  constructor(token, options = {}) {
    assertString("token", token);

    const fetchImpl = options.fetch ?? globalThis.fetch;

    if (typeof fetchImpl !== "function") {
      throw new TypeError("A fetch implementation is required. Use Node.js 18+ or pass options.fetch.");
    }

    this.token = token;
    this.fetch = fetchImpl;
    this.apiRoot = normalizeApiRoot(options.apiRoot ?? DEFAULT_API_ROOT);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async callApi(method, payload = {}, options = {}) {
    assertString("method", method);

    if (!isPlainObject(payload)) {
      throw new TypeError("payload must be a plain object.");
    }

    const body = compactValue(payload);
    const url = buildMethodUrl(this.apiRoot, this.token, method);
    const headers = {
      accept: "application/json",
      "content-type": "application/json; charset=utf-8",
      ...options.headers,
    };

    let response;

    try {
      response = await fetchWithTimeout(
        this.fetch,
        url,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: options.signal,
        },
        options.timeoutMs ?? this.timeoutMs,
      );
    } catch (error) {
      throw new TelegramApiError(`Telegram API request failed for ${method}.`, {
        method,
        cause: error,
      });
    }

    const data = await readResponsePayload(response);

    if (!response.ok) {
      throw new TelegramApiError(
        data?.description || `Telegram API responded with HTTP ${response.status}.`,
        {
          method,
          status: response.status,
          description: data?.description,
          errorCode: data?.error_code,
          parameters: data?.parameters,
        },
      );
    }

    if (!data?.ok) {
      throw new TelegramApiError(
        data?.description || `Telegram API reported an error for ${method}.`,
        {
          method,
          status: response.status,
          description: data?.description,
          errorCode: data?.error_code,
          parameters: data?.parameters,
        },
      );
    }

    return data.result;
  }

  sendMessage(payload, options) {
    return this.callApi("sendMessage", payload, options);
  }

  editMessageText(payload, options) {
    return this.callApi("editMessageText", payload, options);
  }

  answerCallbackQuery(payload, options) {
    return this.callApi("answerCallbackQuery", payload, options);
  }

  setWebhook(payload, options) {
    return this.callApi("setWebhook", payload, options);
  }
}
