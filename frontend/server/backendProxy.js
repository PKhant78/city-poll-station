const MAX_BODY_BYTES = 1024 * 1024;
class BodyTooLarge extends Error {}

async function readBody(request, signal) {
  if (!request.body) return undefined;
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES)
    throw new BodyTooLarge();
  const reader = request.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const chunks = [];
    let size = 0;
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        cancel();
        throw new BodyTooLarge();
      }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

const HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
];

function cleanHeaders(source, request = false) {
  const headers = new Headers(source);
  const nominated = (headers.get("connection") || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  for (const name of [...HOP_HEADERS, ...nominated]) headers.delete(name);
  if (request) {
    for (const name of [...headers.keys()]) {
      if (
        name === "forwarded" ||
        name.startsWith("x-forwarded-") ||
        name.startsWith("x-vercel-forwarded-")
      )
        headers.delete(name);
    }
  }
  return headers;
}

function failure(status, detail) {
  return Response.json(
    { detail },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function proxyBackend(request) {
  let incoming;
  try {
    // Validate before URL parsing can normalize dot segments or backslashes.
    const rawPath =
      request.url.match(/^https?:\/\/[^/?#]+([^?#]*)/i)?.[1] || "";
    const decoded = decodeURIComponent(rawPath);
    if (
      !decoded.startsWith("/api/") ||
      decoded.includes("//") ||
      /[\\\\\u0000-\u0020\u007f]/.test(decoded) ||
      /%[0-9a-f]{2}/i.test(decoded) ||
      decoded.split("/").some((part) => part === "." || part === "..")
    )
      throw new Error("Invalid path");
    incoming = new URL(request.url);
  } catch {
    return failure(400, "Invalid API path.");
  }
  let target;
  try {
    target = new URL(process.env.BACKEND_URL);
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    )
      throw new Error("Invalid binding");
  } catch {
    return failure(503, "Backend service is unavailable.");
  }
  target.pathname = target.pathname.replace(/\/$/, "") + incoming.pathname;
  target.search = incoming.search;
  // The binding is runtime-only. No client-controlled URL or header selects the target.
  const configuredTimeout = Number(process.env.BACKEND_PROXY_TIMEOUT_MS);
  const timeout =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? Math.min(configuredTimeout, 25000)
      : 20000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: cleanHeaders(request.headers, true),
      body: ["GET", "HEAD"].includes(request.method)
        ? undefined
        : await readBody(request, controller.signal),
      redirect: "manual",
      signal: controller.signal,
    });
    const headers = cleanHeaders(upstream.headers);
    // Node fetch decodes compressed upstream bodies but retains encoding metadata.
    if (
      /^(?:(?:gzip|x-gzip|deflate|br)\s*,?\s*)+$/i.test(
        headers.get("content-encoding") || "",
      )
    )
      headers.delete("content-encoding");
    headers.set("Cache-Control", "no-store");
    // Buffer while the timeout is active so a stalled body yields a readable error.
    const body =
      request.method === "HEAD" || [204, 205, 304].includes(upstream.status)
        ? null
        : await upstream.arrayBuffer();
    return new Response(body, { status: upstream.status, headers });
  } catch (error) {
    if (error instanceof BodyTooLarge)
      return failure(413, "Request body exceeds the 1 MiB limit.");
    return controller.signal.aborted
      ? failure(504, "Backend service timed out.")
      : failure(502, "Backend service request failed.");
  } finally {
    clearTimeout(timer);
  }
}
