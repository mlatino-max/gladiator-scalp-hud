import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("../lib/store.js");
const A = require("../lib/alerts.js");

test("memory store round-trips regime, verdict, journal and cron state", async () => {
  S.useStore(new S.MemoryStore());
  await S.saveRegimeSnapshot("scalp", { date: "2026-09-01", regime: "GREEN" });
  await S.saveRegimeSnapshot("scalp", { date: "2026-09-02", regime: "RED" });
  await S.saveRegimeSnapshot("other", { date: "2026-09-02", regime: "GREEN" });
  const snaps = await S.loadRegimeSnapshots("scalp");
  assert.deepEqual(Object.keys(snaps), ["2026-09-01", "2026-09-02"]);
  assert.equal(snaps["2026-09-02"].regime, "RED", "tenants do not bleed into each other");

  await S.saveVerdictSnapshot("scalp", { date: "2026-09-02", verdict: "NO_TRADE", firstBlock: "spread" });
  await S.saveVerdictSnapshot("scalp", { date: "2026-09-01", verdict: "STAGED", firstBlock: null });
  const v = await S.loadVerdictSnapshots("scalp");
  assert.deepEqual(v.map(x => x.date), ["2026-09-01", "2026-09-02"], "ascending by date");

  await S.saveJournal("scalp", { syncedAt: "x", entries: [1, 2] });
  assert.equal((await S.loadJournal("scalp")).entries.length, 2);
  assert.equal(await S.loadJournal("other"), null);

  await S.recordCronRun("regime-snapshot", { ok: true });
  assert.equal((await S.lastCronRun("regime-snapshot")).ok, true);
  await assert.rejects(() => S.saveRegimeSnapshot("scalp", { regime: "GREEN" }), /needs a date/);
});

test("alerts fire once per state and never throw without a channel", async () => {
  S.useStore(new S.MemoryStore());
  delete process.env.ALERT_PUSH_URL;
  const first = await A.alertOnce("scalp", "tier", "ANECDOTE", "t", "b");
  assert.equal(first.sent, false);
  assert.equal(first.reason, "ALERT_PUSH_URL not set");
  const again = await A.alertOnce("scalp", "tier", "ANECDOTE", "t", "b");
  assert.equal(again.reason, "unchanged", "same state is de-duplicated even when unsent");
  const changed = await A.alertOnce("scalp", "tier", "HYPOTHESIS", "t", "b");
  assert.equal(changed.reason, "ALERT_PUSH_URL not set", "a new state is a new attempt");
});

test("evaluate: armed ticket alerts once per date, gate state once per change", async () => {
  S.useStore(new S.MemoryStore());
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, title: init.headers.title, body: init.body }); return { ok: true, status: 200 }; };
  process.env.ALERT_PUSH_URL = "https://ntfy.example/test";
  try {
    const ticket = { symbol: "SOFI", entry_est: 19.21, stop: 18.9, target: 19.68, shares: 39, dollars_at_risk: 12.09,
      gates: [{ key: "band", blocking: true, pass: true }, { key: "trigger", blocking: false, pass: true }] };
    const a = await A.evaluate("scalp", { etDate: "2026-09-02", verdict: "TRADE_ARMED", ticket, tier: { tier: "ANECDOTE", label: "n=3", note: "" } });
    assert.deepEqual(a, ["ticket_armed", "gate_flip", "tier"]);
    assert.match(calls[0].body, /SOFI entry 19.21 stop 18.9/);
    const b = await A.evaluate("scalp", { etDate: "2026-09-02", verdict: "TRADE_ARMED", ticket, tier: { tier: "ANECDOTE", label: "n=3", note: "" } });
    assert.deepEqual(b, [], "the same refresh does not re-send");
    const blocked = { ...ticket, gates: [{ key: "spread", blocking: true, pass: false }] };
    const c = await A.evaluate("scalp", { etDate: "2026-09-02", verdict: "NO_TRADE", ticket: blocked });
    assert.deepEqual(c, ["gate_flip"]);
    assert.match(calls[calls.length - 1].body, /failing: spread/);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ALERT_PUSH_URL;
  }
});

test("store() honours KV_ENV_PREFIX and prefers the bare names", () => {
  const saved = { ...process.env };
  try {
    for (const k of Object.keys(process.env)) if (/KV_REST_API|KV_ENV_PREFIX/.test(k)) delete process.env[k];
    S.useStore(null);
    assert.equal(S.store().kind, "memory", "no variables at all → memory");

    process.env.KV_ENV_PREFIX = "gladiator_scalp_";
    process.env.gladiator_scalp_KV_REST_API_URL = "https://prefixed.example";
    process.env.gladiator_scalp_KV_REST_API_TOKEN = "t1";
    S.useStore(null);
    assert.equal(S.store().kind, "kv", "prefixed variables are found through KV_ENV_PREFIX");
    assert.equal(S.store().url, "https://prefixed.example");

    process.env.KV_REST_API_URL = "https://bare.example";
    process.env.KV_REST_API_TOKEN = "t2";
    S.useStore(null);
    assert.equal(S.store().url, "https://bare.example", "bare names win over the prefix");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    S.useStore(new S.MemoryStore());
  }
});

test("file store persists across instances and rewrites atomically", async () => {
  const { mkdtempSync, existsSync, readdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = mkdtempSync(path.join(tmpdir(), "hud-store-"));
  const file = path.join(dir, "nested", "store.json");
  const a = S.useStore(new S.FileStore(file));
  assert.equal(a.kind, "file");
  assert.equal(await S.loadJournal("scalp"), null, "empty before the first write, no file needed");
  await S.saveRegimeSnapshot("scalp", { date: "2026-09-08", regime: "GREEN" });
  await S.recordCronRun("journal-sync", { ok: true, n: 3 });
  assert.ok(existsSync(file), "written on first set");
  assert.deepEqual(readdirSync(path.dirname(file)), ["store.json"], "no temp file left behind");
  /* a fresh instance (a restarted container) sees the same state */
  S.useStore(new S.FileStore(file));
  assert.equal((await S.loadRegimeSnapshots("scalp"))["2026-09-08"].regime, "GREEN");
  assert.equal((await S.lastCronRun("journal-sync")).n, 3);
  assert.equal(await a.ping(), true);
  S.useStore(new S.MemoryStore());
});
