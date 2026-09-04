/* Durable state for v2: regime snapshots, persisted round trips, verdict
   snapshots, alert de-dupe. Backed by Vercel KV (Upstash REST) when
   KV_REST_API_URL / KV_REST_API_TOKEN are set; otherwise an in-process
   memory map that is honest about being volatile (`store.kind`). */
"use strict";

const PREFIX = process.env.HUD_STORE_PREFIX || "hud:v2";

class MemoryStore {
  constructor() { this.kind = "memory"; this.map = new Map(); }
  async get(key) { return this.map.has(key) ? JSON.parse(this.map.get(key)) : null; }
  async set(key, value) { this.map.set(key, JSON.stringify(value)); return true; }
  async del(key) { return this.map.delete(key); }
  async keys(prefix) { return [...this.map.keys()].filter(k => k.startsWith(prefix)).sort(); }
  async ping() { return true; }
}

class KvStore {
  constructor(url, token) { this.kind = "kv"; this.url = url.replace(/\/+$/, ""); this.token = token; }
  async cmd(...args) {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(args)
    });
    if (!res.ok) {
      const err = new Error(`KV ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      err.status = 502;
      throw err;
    }
    const j = await res.json();
    if (j.error) { const err = new Error(`KV error: ${j.error}`); err.status = 502; throw err; }
    return j.result;
  }
  async get(key) { const v = await this.cmd("GET", key); return v == null ? null : JSON.parse(v); }
  async set(key, value) { await this.cmd("SET", key, JSON.stringify(value)); return true; }
  async del(key) { return (await this.cmd("DEL", key)) > 0; }
  async keys(prefix) {
    const out = [];
    let cursor = "0";
    for (let i = 0; i < 50; i++) {
      const [next, batch] = await this.cmd("SCAN", cursor, "MATCH", `${prefix}*`, "COUNT", "200");
      out.push(...(batch || []));
      cursor = String(next);
      if (cursor === "0") break;
    }
    return out.sort();
  }
  async ping() { return (await this.cmd("PING")) === "PONG"; }
}

let _store = null;
function store() {
  if (_store) return _store;
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  _store = url && token ? new KvStore(url, token) : new MemoryStore();
  return _store;
}
/* tests swap in a fresh MemoryStore */
function useStore(s) { _store = s; return s; }

const key = {
  strategy: (id) => `${PREFIX}:strategy:${id}`,
  regime: (strategy, date) => `${PREFIX}:regime:${strategy}:${date}`,
  regimePrefix: (strategy) => `${PREFIX}:regime:${strategy}:`,
  journal: (strategy) => `${PREFIX}:journal:${strategy}`,
  verdict: (strategy, date) => `${PREFIX}:verdict:${strategy}:${date}`,
  verdictPrefix: (strategy) => `${PREFIX}:verdict:${strategy}:`,
  alert: (strategy, k) => `${PREFIX}:alert:${strategy}:${k}`,
  cron: (name) => `${PREFIX}:cron:${name}`
};

/* ---- typed helpers ---- */
async function saveRegimeSnapshot(strategy, snap) {
  if (!snap || !snap.date) throw new Error("regime snapshot needs a date");
  await store().set(key.regime(strategy, snap.date), snap);
  return snap;
}
async function loadRegimeSnapshots(strategy) {
  const s = store();
  const keys = await s.keys(key.regimePrefix(strategy));
  const out = {};
  for (const k of keys) {
    const v = await s.get(k);
    if (v && v.date) out[v.date] = v;
  }
  return out;
}
async function saveJournal(strategy, doc) { await store().set(key.journal(strategy), doc); return doc; }
async function loadJournal(strategy) { return store().get(key.journal(strategy)); }

async function saveVerdictSnapshot(strategy, snap) {
  if (!snap || !snap.date) throw new Error("verdict snapshot needs a date");
  await store().set(key.verdict(strategy, snap.date), snap);
  return snap;
}
async function loadVerdictSnapshots(strategy) {
  const s = store();
  const keys = await s.keys(key.verdictPrefix(strategy));
  const out = [];
  for (const k of keys) { const v = await s.get(k); if (v) out.push(v); }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
async function getAlertState(strategy, k) { return store().get(key.alert(strategy, k)); }
async function setAlertState(strategy, k, v) { await store().set(key.alert(strategy, k), v); }
async function recordCronRun(name, run) { await store().set(key.cron(name), run); return run; }
async function lastCronRun(name) { return store().get(key.cron(name)); }

module.exports = {
  store, useStore, MemoryStore, KvStore, key,
  saveRegimeSnapshot, loadRegimeSnapshots, saveJournal, loadJournal,
  saveVerdictSnapshot, loadVerdictSnapshots, getAlertState, setAlertState,
  recordCronRun, lastCronRun
};
