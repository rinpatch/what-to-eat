export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson(url, options = {}) {
  const {
    body,
    headers = {},
    method = body ? "POST" : "GET",
    retries = 1,
    timeoutMs = 120_000,
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...(body && typeof body !== "string"
            ? { "Content-Type": "application/json" }
            : {}),
          ...headers,
        },
        body: body && typeof body !== "string" ? JSON.stringify(body) : body,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `${method} ${url} failed with ${response.status}: ${text.slice(0, 600)}`,
        );
      }
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        const lines = text.split(/\r?\n/).filter((line) => line.trim());
        if (lines.length > 1) {
          try {
            return lines.map((line) => JSON.parse(line));
          } catch {
            return text;
          }
        }
        return text;
      }
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(900 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}
