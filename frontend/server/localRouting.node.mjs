import { test } from "node:test";
import assert from "node:assert/strict";

async function configFor(vercel, suffix) {
  const original = process.env.VERCEL;
  try {
    if (vercel) process.env.VERCEL = "1";
    else delete process.env.VERCEL;
    return (await import(`../vite.config.js?${suffix}`)).default;
  } finally {
    if (original === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = original;
  }
}

test("Vercel local routing cannot bypass the binding function through Vite proxy", async () => {
  const config = await configFor(true, "vercel");
  assert.equal(config.server.proxy, undefined);
});

test("Vercel builds include the Nitro runtime adapter for API functions", async () => {
  const config = await configFor(true, "nitro");
  assert.ok(
    config.plugins
      .flat(Infinity)
      .some((plugin) => plugin?.name?.includes("nitro")),
  );
});

test("standalone npm dev preserves its local Python API proxy", async () => {
  const config = await configFor(false, "standalone");
  assert.equal(config.server.proxy["/api"], "http://localhost:8000");
});
