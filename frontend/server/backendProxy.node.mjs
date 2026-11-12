import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import { test } from "node:test";

let proxy;
try {
  proxy = (await import("../api/[...path].js")).default;
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

async function upstream(t, handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function binding(t, value) {
  const previous = process.env.BACKEND_URL;
  if (value === undefined) delete process.env.BACKEND_URL;
  else process.env.BACKEND_URL = value;
  t.after(() => {
    if (previous === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = previous;
  });
}

const request = (path, options) =>
  new Request(`https://frontend.example${path}`, options);

async function errorResponse(response, status) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(typeof (await response.json()).detail, "string");
}

test("missing or invalid private binding returns sanitized 503", async (t) => {
  binding(t, undefined);
  await errorResponse(await proxy.fetch(request("/api/session")), 503);
  for (const url of [
    "not-a-url-secret",
    "file:///private/secret",
    "https://user:password@example.test",
    "https://example.test/?secret=x",
  ]) {
    process.env.BACKEND_URL = url;
    const response = await proxy.fetch(request("/api/session"));
    const text = await response.clone().text();
    assert.ok(!text.includes(url));
    await errorResponse(response, 503);
  }
});

test("proxy strips hop-by-hop, nominated, host and untrusted forwarding headers in both directions", async (t) => {
  let seen;
  binding(
    t,
    await upstream(t, (req, res) => {
      seen = req.headers;
      res.writeHead(200, {
        Connection: "close, x-internal",
        "X-Internal": "secret",
        "X-End-To-End": "kept",
        "Content-Length": "2",
      });
      res.end("{}");
    }),
  );
  const response = await proxy.fetch(
    request("/api/session", {
      headers: {
        Host: "attacker.example",
        Connection: "close, x-remove",
        "X-Remove": "secret",
        Forwarded: "host=attacker.example",
        "X-Forwarded-Host": "attacker.example",
        "X-Forwarded-For": "1.2.3.4",
        "X-Forwarded-Proto": "http",
        "X-Vercel-Forwarded-For": "1.2.3.4",
      },
    }),
  );
  assert.notEqual(seen.host, "attacker.example");
  for (const name of [
    "x-remove",
    "forwarded",
    "x-forwarded-host",
    "x-forwarded-for",
    "x-forwarded-proto",
    "x-vercel-forwarded-for",
  ])
    assert.equal(seen[name], undefined, name);
  for (const name of [
    "connection",
    "x-internal",
    "content-length",
    "transfer-encoding",
  ])
    assert.equal(response.headers.get(name), null, name);
  assert.equal(response.headers.get("x-end-to-end"), "kept");
});

test("rejects non-API, double slash and traversal paths before contacting backend", async (t) => {
  let hits = 0;
  binding(
    t,
    await upstream(t, (_req, res) => {
      hits++;
      res.end("{}");
    }),
  );
  for (const path of [
    "/outside",
    "//evil.example/api/session",
    "/api//evil.example",
    "/api/../secret",
    "/api/%2e%2e/secret",
    "/api/%252e%252e/secret",
    "/api/%2f%2fevil.example",
    "/api/..%5csecret",
    "/api/%ZZ",
  ]) {
    const raw = {
      url: `https://frontend.example${path}`,
      method: "GET",
      headers: new Headers(),
    };
    await errorResponse(await proxy.fetch(raw), 400);
  }
  assert.equal(hits, 0);
});

test("upstream transport failures return sanitized 502", async (t) => {
  binding(t, await upstream(t, (req) => req.socket.destroy()));
  await errorResponse(await proxy.fetch(request("/api/session")), 502);
});

test(
  "upstream timeout includes delayed response body and returns 504",
  { timeout: 1000 },
  async (t) => {
    const previous = process.env.BACKEND_PROXY_TIMEOUT_MS;
    process.env.BACKEND_PROXY_TIMEOUT_MS = "30";
    t.after(() => {
      if (previous === undefined) delete process.env.BACKEND_PROXY_TIMEOUT_MS;
      else process.env.BACKEND_PROXY_TIMEOUT_MS = previous;
    });
    binding(
      t,
      await upstream(t, (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.flushHeaders();
        res.write("{");
      }),
    );
    await errorResponse(await proxy.fetch(request("/api/session")), 504);
  },
);

test("request bodies are capped at 1 MiB before forwarding including chunked bodies", async (t) => {
  let hits = 0;
  binding(
    t,
    await upstream(t, async (req, res) => {
      hits++;
      for await (const _chunk of req) {
        /* consume */
      }
      res.end("{}");
    }),
  );
  await errorResponse(
    await proxy.fetch(
      request("/api/projects", {
        method: "POST",
        body: "x".repeat(1024 * 1024 + 1),
      }),
    ),
    413,
  );
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(600000));
      controller.enqueue(new Uint8Array(600000));
      controller.close();
    },
  });
  await errorResponse(
    await proxy.fetch(
      request("/api/projects", { method: "PUT", body: stream, duplex: "half" }),
    ),
    413,
  );
  assert.equal(hits, 0);
  assert.equal(
    (
      await proxy.fetch(
        request("/api/projects", {
          method: "POST",
          body: "x".repeat(1024 * 1024),
        }),
      )
    ).status,
    200,
  );
  assert.equal(hits, 1);
});

test("preserves all auth Set-Cookie headers separately including Expires commas", async (t) => {
  const cookies = [
    "session=abc; Path=/; HttpOnly; Secure; SameSite=Lax",
    "csrf=xyz; Path=/; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Secure",
  ];
  binding(
    t,
    await upstream(t, (_req, res) => {
      res.writeHead(200, {
        "Set-Cookie": cookies,
        "Content-Type": "application/json",
      });
      res.end('{"authenticated":true}');
    }),
  );
  const response = await proxy.fetch(request("/api/auth/session"));
  assert.deepEqual(response.headers.getSetCookie(), cookies);
  assert.deepEqual(await response.json(), { authenticated: true });
});

test("preserves backend 401, 403 and validation 422 JSON without replacing detail", async (t) => {
  binding(
    t,
    await upstream(t, (req, res) => {
      const status = Number(req.url.split("/").at(-1));
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          detail:
            status === 422
              ? [{ loc: ["body", "name"], msg: "Required" }]
              : "Not allowed",
        }),
      );
    }),
  );
  for (const status of [401, 403, 422]) {
    const response = await proxy.fetch(
      request(`/api/status/${status}`, {
        headers: { Origin: "https://bad.example" },
      }),
    );
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      detail:
        status === 422
          ? [{ loc: ["body", "name"], msg: "Required" }]
          : "Not allowed",
    });
  }
});

test("DELETE 204 and HEAD return no body", async (t) => {
  const seen = [];
  binding(
    t,
    await upstream(t, (req, res) => {
      seen.push(req.method);
      res.writeHead(req.method === "DELETE" ? 204 : 200, {
        "X-Metadata": "kept",
      });
      res.end();
    }),
  );
  for (const method of ["DELETE", "HEAD"]) {
    const response = await proxy.fetch(
      request("/api/projects/123", { method }),
    );
    assert.equal(response.status, method === "DELETE" ? 204 : 200);
    assert.equal(response.body, null);
    assert.equal(await response.text(), "");
    assert.equal(response.headers.get("x-metadata"), "kept");
  }
  assert.deepEqual(seen, ["DELETE", "HEAD"]);
});

test("never follows redirects or query-supplied URLs to another host", async (t) => {
  let externalHits = 0;
  const external = await upstream(t, (_req, res) => {
    externalHits++;
    res.end("secret");
  });
  binding(
    t,
    await upstream(t, (_req, res) => {
      res.writeHead(307, {
        Location: `${external}/auth`,
        "Set-Cookie": "session=xyz; Path=/; HttpOnly",
      });
      res.end("Redirect");
    }),
  );
  const response = await proxy.fetch(
    request(`/api/auth/login?url=${encodeURIComponent(external)}`),
  );
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), `${external}/auth`);
  assert.equal(
    response.headers.getSetCookie()[0],
    "session=xyz; Path=/; HttpOnly",
  );
  assert.equal(externalHits, 0);
});

test("decoded compressed responses do not advertise the upstream content encoding", async (t) => {
  binding(
    t,
    await upstream(t, (_req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      });
      res.end(gzipSync('{"ok":true}'));
    }),
  );
  const response = await proxy.fetch(request("/api/projects"));
  assert.equal(response.headers.get("content-encoding"), null);
  assert.deepEqual(await response.json(), { ok: true });
});

test("catchall forwards API path, query, method, bytes, cookie and original Origin to binding base path", async (t) => {
  assert.equal(
    typeof proxy?.fetch,
    "function",
    "catchall must export a fetch handler",
  );
  let observed;
  binding(
    t,
    `${await upstream(t, async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      observed = {
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks),
      };
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    })}/private/`,
  );
  const body = '{"name":"é"}';
  const response = await proxy.fetch(
    request("/api/projects?x=a%2Fb&x=2", {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        Cookie: "session=abc",
        Origin: "https://untrusted.example",
      },
    }),
  );
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(observed.url, "/private/api/projects?x=a%2Fb&x=2");
  assert.equal(observed.method, "POST");
  assert.equal(observed.body.toString(), body);
  assert.equal(observed.headers.cookie, "session=abc");
  assert.equal(observed.headers.origin, "https://untrusted.example");
});
