import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const H = require("../lib/hermes.js");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "hermes-"));

test("hermesDir sits next to the file store unless HERMES_DIR overrides it", () => {
  const keep = { d: process.env.HERMES_DIR, s: process.env.HUD_STORE_FILE };
  delete process.env.HERMES_DIR;
  process.env.HUD_STORE_FILE = path.join("/data", "store.json");
  assert.equal(H.hermesDir(), path.join("/data", "hermes"));
  process.env.HERMES_DIR = "/elsewhere";
  assert.equal(H.hermesDir(), "/elsewhere");
  for (const [k, v] of [["HERMES_DIR", keep.d], ["HUD_STORE_FILE", keep.s]]) v === undefined ? delete process.env[k] : (process.env[k] = v);
});

test("a deployment with no sidecar reports no desk instead of throwing", () => {
  const dir = path.join(tmp(), "missing");
  assert.deepEqual(H.deskStatus(dir), { available: false, renderedAt: null, bytes: 0, lastRun: null });
  assert.equal(H.readDesk(dir), null);
});

test("a rendered desk is served with its status, and a failed run keeps the last good picture", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "hermes_desk.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify({ ok: true, at: "2026-09-18T21:20:00Z", message: "rsi2=939 (+12)" }));
  let s = H.deskStatus(dir);
  assert.equal(s.available, true);
  assert.equal(s.bytes, 4);
  assert.match(s.renderedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(s.lastRun.ok, true);
  assert.equal(H.readDesk(dir).length, 4);

  fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify({ ok: false, at: "2026-09-19T14:05:00Z", message: "render failed: KV error" }));
  s = H.deskStatus(dir);
  assert.equal(s.available, true, "the last good PNG is still there");
  assert.equal(s.lastRun.ok, false);

  fs.writeFileSync(path.join(dir, "status.json"), "{not json");
  assert.equal(H.deskStatus(dir).lastRun, null, "a half-written status file is ignored, not fatal");
});
