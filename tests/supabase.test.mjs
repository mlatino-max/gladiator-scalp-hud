import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("../lib/supabase.js");

const KEY = "service-role-test-key-never-logged";
function withEnv(fn) {
  const saved = { ...process.env };
  process.env.SUPABASE_URL = "https://proj.supabase.co/";
  process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const call = { url: String(url), method: init.method || "GET", headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const r = (fn.respond && fn.respond(call)) || {};
    return {
      ok: r.status ? r.status < 400 : true, status: r.status || 200,
      headers: { get: (k) => (r.headers || {})[k.toLowerCase()] || null },
      text: async () => (r.body === undefined ? "" : JSON.stringify(r.body))
    };
  };
  return {
    calls,
    restore() {
      globalThis.fetch = realFetch;
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  };
}

test("not configured: heartbeat is a no-op, rest throws 503 with a hint, no fetch", async () => {
  const saved = { ...process.env };
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  let fetched = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched++; };
  try {
    assert.equal(S.configured(), false);
    assert.deepEqual(await S.heartbeat("scan"), { ok: false, reason: "not configured" });
    await assert.rejects(() => S.select("heartbeats"), (e) => e.status === 503 && /recreate hud/.test(e.hint));
    assert.equal(fetched, 0);
  } finally { globalThis.fetch = realFetch; Object.assign(process.env, saved); }
});

test("upsert: PostgREST path, on_conflict, prefer headers, auth headers, chunking", async () => {
  const env = withEnv({});
  try {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ alpaca_fill_id: `f${i}`, qty: 1 }));
    await S.upsert("fills", rows, "alpaca_fill_id", { returning: true });
    assert.equal(env.calls.length, 3, "1000-row chunks");
    const c = env.calls[0];
    assert.equal(c.url, "https://proj.supabase.co/rest/v1/fills?on_conflict=alpaca_fill_id");
    assert.equal(c.method, "POST");
    assert.equal(c.headers.apikey, KEY);
    assert.equal(c.headers.authorization, `Bearer ${KEY}`);
    assert.equal(c.headers.prefer, "return=representation,resolution=merge-duplicates");
    assert.equal(c.body.length, 1000);
    assert.equal(env.calls[2].body.length, 500);
    await S.upsert("symbols", [{ symbol: "SPY" }], "symbol", { ignoreDuplicates: true });
    assert.equal(env.calls[3].headers.prefer, "return=minimal,resolution=ignore-duplicates");
    assert.deepEqual(await S.insert("x", []), []);
    assert.equal(env.calls.length, 4, "empty input never calls out");
  } finally { env.restore(); }
});

test("count uses HEAD + count=exact and parses Content-Range; select builds filters", async () => {
  const env = withEnv({ respond: (c) => c.method === "HEAD" ? { headers: { "content-range": "*/42" } } : { body: [{ trades: 4 }] } });
  try {
    assert.equal(await S.count("round_trips", { opened_at: "gte.2026-01-01" }), 42);
    const h = env.calls[0];
    assert.equal(h.method, "HEAD");
    assert.equal(h.headers.prefer, "count=exact");
    assert.match(h.url, /round_trips\?select=\*&opened_at=gte\.2026-01-01$/);
    const rows = await S.select("v_journal_stats", { limit: 1 });
    assert.deepEqual(rows, [{ trades: 4 }]);
    assert.equal(S.countFrom("0-24/*"), null);
    assert.equal(S.countFrom("0-9/10"), 10);
  } finally { env.restore(); }
});

test("errors carry the upstream status, never the key; heartbeat swallows them", async () => {
  const env = withEnv({ respond: () => ({ status: 401, body: { message: "JWT expired" } }) });
  try {
    await assert.rejects(() => S.select("orders"), (e) => {
      assert.equal(e.status, 502);
      assert.equal(e.upstream, 401);
      assert.ok(!e.message.includes(KEY));
      assert.match(e.message, /Supabase 401 on orders/);
      return true;
    });
    const hb = await S.heartbeat("scan");
    assert.equal(hb.ok, false);
    assert.match(hb.reason, /401/);
  } finally { env.restore(); }
});
