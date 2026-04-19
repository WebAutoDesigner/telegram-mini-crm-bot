import http from "node:http";

const MAX_JSON_BODY_BYTES = 256 * 1024;

class PayloadTooLargeError extends Error {
  constructor(message = "payload_too_large") {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

function readJsonBody(request, { maxBytes = MAX_JSON_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new PayloadTooLargeError());
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function isTelegramWebhookAuthorized(request, secret) {
  const headerSecret = request.headers["x-telegram-bot-api-secret-token"];
  return typeof headerSecret === "string" && headerSecret === secret;
}

export function createHttpServer({ config, app }) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, { ok: true });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === `/telegram/webhook/${config.botWebhookSecret}`
    ) {
      if (!isTelegramWebhookAuthorized(request, config.botWebhookSecret)) {
        writeJson(response, 401, { ok: false, error: "unauthorized" });
        return;
      }

      try {
        const update = await readJsonBody(request);
        await app.handleTelegramUpdate(update);
        writeJson(response, 200, { ok: true });
      } catch (error) {
        console.error("[telegram-webhook]", error);
        writeJson(
          response,
          error instanceof SyntaxError ? 400 : error instanceof PayloadTooLargeError ? 413 : 500,
          {
            ok: false,
            error:
              error instanceof SyntaxError
                ? "invalid_json"
                : error instanceof PayloadTooLargeError
                  ? "payload_too_large"
                  : "internal_error"
          }
        );
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/leads") {
      const apiKey = request.headers["x-api-key"];
      if (apiKey !== config.siteApiKey) {
        writeJson(response, 401, { success: false, error: "unauthorized" });
        return;
      }

      try {
        const payload = await readJsonBody(request);
        const result = await app.handleSiteLead(payload);
        writeJson(response, result.success ? 200 : 400, result);
      } catch (error) {
        console.error("[site-lead]", error);
        writeJson(
          response,
          error instanceof SyntaxError ? 400 : error instanceof PayloadTooLargeError ? 413 : 500,
          {
            success: false,
            error:
              error instanceof SyntaxError
                ? "invalid_json"
                : error instanceof PayloadTooLargeError
                  ? "payload_too_large"
                  : "internal_error"
          }
        );
      }
      return;
    }

    writeJson(response, 404, { ok: false, error: "not_found" });
  });
}
