import https from "node:https";

export function ipv4Fetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const { method = "GET", headers = {}, body, signal } = init;
    const parsed = new URL(url);

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method,
        headers,
        family: 4,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: { get: (name) => res.headers[name.toLowerCase()] ?? null },
            text: () => Promise.resolve(text),
            json: () => Promise.resolve(JSON.parse(text)),
          });
        });
        res.on("error", reject);
      },
    );

    req.on("error", reject);

    if (signal) {
      signal.addEventListener("abort", () => req.destroy(signal.reason), { once: true });
    }

    if (body) req.write(body);
    req.end();
  });
}
