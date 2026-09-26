import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SC = require("../lib/screen.js");
const S = require("../lib/store.js");

test("barRow maps a Massive grouped result to a bars_daily row and rejects junk", () => {
  const r = SC.barRow({ T: "SOFI", o: 19.1, h: 19.6, l: 18.9, c: 19.4, v: 25123456.0, vw: 19.3, n: 12345, t: 1 }, "2026-09-04");
  assert.deepEqual(r, { symbol: "SOFI", session_date: "2026-09-04", open: 19.1, high: 19.6, low: 18.9, close: 19.4, volume: 25123456, source: "massive" });
  assert.equal(SC.barRow({ T: "X", o: 1, h: 1, l: 1 }, "2026-09-04"), null, "missing close/volume");
  assert.equal(SC.barRow({ T: "", o: 1, h: 1, l: 1, c: 1, v: 1 }, "2026-09-04"), null, "no ticker");
  assert.equal(SC.barRow({ T: "BIG", o: 1e8, h: 1e8, l: 1e8, c: 1e8, v: 1 }, "2026-09-04"), null, "outside numeric(12,4)");
});

test("classifyTicker: common stock screens, funds are flagged, the rest is excluded by type", () => {
  const cs = SC.classifyTicker({ ticker: "SOFI", name: "SoFi Technologies", type: "CS" });
  assert.equal(cs.excluded, false); assert.equal(cs.is_etf, false); assert.equal(cs.is_leveraged, false);
  const adr = SC.classifyTicker({ ticker: "TSM", name: "Taiwan Semiconductor", type: "ADRC" });
  assert.equal(adr.excluded, false);
  const etf = SC.classifyTicker({ ticker: "SPY", name: "SPDR S&P 500 ETF Trust", type: "ETF" });
  assert.equal(etf.is_etf, true); assert.equal(etf.is_leveraged, false); assert.equal(etf.excluded, false);
  const lev = SC.classifyTicker({ ticker: "SOXL", name: "Direxion Daily Semiconductor Bull 3X Shares", type: "ETF" });
  assert.equal(lev.is_etf, true); assert.equal(lev.is_leveraged, true);
  const inv = SC.classifyTicker({ ticker: "SQQQ", name: "ProShares UltraPro Short QQQ", type: "ETF" });
  assert.equal(inv.is_leveraged, true);
  const w = SC.classifyTicker({ ticker: "ABCW", name: "ABC Warrants", type: "WARRANT" });
  assert.equal(w.excluded, true); assert.equal(w.exclude_reason, "type:WARRANT");
  const u = SC.classifyTicker({ ticker: "ABCU", name: "ABC Units", type: "UNIT" });
  assert.equal(u.exclude_reason, "type:UNIT");
  const pfd = SC.classifyTicker({ ticker: "BACpB", name: "Bank of America Pref", type: "PFD" });
  assert.equal(pfd.excluded, true);
  const crypto = SC.classifyTicker({ ticker: "IBIT", name: "iShares Bitcoin Trust", type: "ETF" });
  assert.equal(crypto.excluded, true); assert.equal(crypto.exclude_reason, "crypto_proxy");
  const proxy = SC.classifyTicker({ ticker: "BTCT", name: "Bitcoin Treasury Corp", type: "CS" });
  assert.equal(proxy.exclude_reason, "crypto_proxy");
  const unknown = SC.classifyTicker({ ticker: "ZZZ", name: "", type: "" });
  assert.equal(unknown.exclude_reason, "type:unknown"); assert.equal(unknown.name, null);
  assert.equal(SC.classifyTicker({ ticker: "" }), null);
});

test("sessionDatesFrom: last n sessions, never the future, today only once final", () => {
  const cal = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-08"].map(date => ({ date }));
  const notFinal = SC.sessionDatesFrom(cal, "2026-09-08", false, 8);
  assert.deepEqual(notFinal, ["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"].slice(-8));
  assert.equal(notFinal.includes("2026-09-08"), false, "today's bars are not final during the session");
  const final = SC.sessionDatesFrom(cal, "2026-09-08", true, 8);
  assert.equal(final[final.length - 1], "2026-09-08");
  assert.equal(final.length, 8);
  assert.deepEqual(SC.sessionDatesFrom([{ date: "2026-09-09" }], "2026-09-08", true, 8), [], "a future calendar day is never a session");
});

function mockSupabase(respond) {
  const saved = { ...process.env };
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const call = { url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined, prefer: init.headers.prefer };
    calls.push(call);
    const r = respond(call) || {};
    return { ok: true, status: 200, headers: { get: (k) => (r.headers || {})[k] || null }, text: async () => (r.body === undefined ? "" : JSON.stringify(r.body)) };
  };
  return { calls, restore() { globalThis.fetch = realFetch; for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); } };
}

test("runScreen reads the view, books the run and ranks the survivors as the view ordered them", async () => {
  S.useStore(new S.MemoryStore());
  const view = [
    { symbol: "AAA", last_close: 20, window_high: 22, window_low: 19, pullback_pct: 9.09, stop_dist_pct: 5, reward_risk: 2 },
    { symbol: "BBB", last_close: 50, window_high: 54, window_low: 48, pullback_pct: 7.41, stop_dist_pct: 4, reward_risk: 2 }
  ];
  const env = mockSupabase((c) => {
    if (/v_pullback_screen/.test(c.url)) return { body: view };
    if (/bars_daily\?select=session_date/.test(c.url)) return { body: [{ session_date: "2026-09-04" }] };
    if (c.method === "HEAD") return { headers: { "content-range": "*/11234" } };
    if (/screen_runs/.test(c.url)) return { body: [{ id: 7, run_at: "2026-09-08T12:45:00Z" }] };
    return {};
  });
  try {
    const preview = await SC.runScreen({ record: false });
    assert.equal(preview.sessionDate, "2026-09-04");
    assert.equal(preview.universeCount, 11234);
    assert.equal(preview.survivorCount, 2);
    assert.equal(preview.run, null);
    assert.equal(env.calls.some(c => /screen_runs|screen_candidates/.test(c.url)), false, "a preview writes nothing");

    const booked = await SC.runScreen({ record: true, notes: "test" });
    assert.deepEqual(booked.run, { id: 7, runAt: "2026-09-08T12:45:00Z", candidates: 2 });
    const runPost = env.calls.find(c => /screen_runs/.test(c.url));
    assert.deepEqual(runPost.body, [{ screen_version: SC.SCREEN_VERSION, session_date: "2026-09-04", universe_count: 11234, survivor_count: 2, notes: "test" }]);
    const cand = env.calls.find(c => /screen_candidates/.test(c.url));
    assert.deepEqual(cand.body.map(r => [r.run_id, r.symbol, r.rank, r.rejected_reason]), [[7, "AAA", 1, null], [7, "BBB", 2, null]]);
    assert.equal(cand.body[0].reward_risk, 2);
    assert.equal((await S.lastCronRun("screen")).runId, 7);
  } finally { env.restore(); S.useStore(new S.MemoryStore()); }
});
