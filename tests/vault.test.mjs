/* scripts/fetch-vault.mjs in VAULT_DIR mode: the same allowlist, the same
   publish: true rule and the same guards as the GitHub path, against a
   throwaway vault on disk. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.resolve("scripts/fetch-vault.mjs");

function vaultFixture(extra) {
  const root = mkdtempSync(path.join(tmpdir(), "hud-vault-"));
  const put = (rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text); };
  put("TradeCenter/Ops Manual.md", "---\ncreated: 2026-09-01\npublish: true\ntags: [ops, hud]\n---\nDoctrine [[Home]]\n");
  put("TradeCenter/Private Draft.md", "---\ncreated: 2026-09-01\n---\nnot published\n");
  put("Journal/Daily/2026-09-05.md", "---\npublish: true\n---\n- NO_TRADE\n");
  put("SGS/Roster.md", "---\npublish: true\n---\noutside the allowlist\n");
  put(".obsidian/plugins/x/Secret.md", "---\npublish: true\n---\nhidden folders are never entered\n");
  put("Projects/Trading/SCALPER-HUD/bot/tickets/2026-09-05-SOFI.json", JSON.stringify({ symbol: "SOFI", entry: 19.2 }));
  if (extra) for (const [rel, text] of Object.entries(extra)) put(rel, text);
  return root;
}
function run(dir, out) {
  return execFileSync(process.execPath, [SCRIPT], {
    env: { ...process.env, VAULT_DIR: dir, VAULT_INDEX_OUT: out, GITHUB_VAULT_TOKEN: "" },
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  });
}

test("local vault: allowlist, publish flag, hidden folders, tickets", () => {
  const dir = vaultFixture();
  const out = path.join(dir, "out", "index.json");
  const log = run(dir, out);
  const idx = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(idx.source, "local");
  assert.deepEqual(idx.notes.map(n => n.path).sort(), ["Journal/Daily/2026-09-05.md", "TradeCenter/Ops Manual.md"]);
  assert.equal(idx.skipped, 1, "the unpublished note in an allowlisted folder is counted as skipped");
  const ops = idx.notes.find(n => n.path.startsWith("TradeCenter"));
  assert.equal(ops.slug, "tradecenter/ops-manual");
  assert.deepEqual(ops.tags, ["ops", "hud"]);
  assert.equal(ops.date, "2026-09-01");
  assert.equal(idx.notes.find(n => n.folder === "Journal/Daily").date, "2026-09-05", "date taken from the filename");
  assert.equal(idx.tickets.length, 1);
  assert.equal(idx.tickets[0].symbol, "SOFI");
  assert.equal(idx.tickets[0].date, "2026-09-05");
  assert.match(log, /local: 2 published notes, 1 tickets/);
});

test("local vault: a published note that trips a guard fails the run and writes nothing", () => {
  const dir = vaultFixture({ "TradeCenter/Leak.md": "---\npublish: true\n---\nAPCA-API-SECRET-KEY: abcdefghijklmnopqrstuvwxyz0123456789\n" });
  const out = path.join(dir, "out", "index.json");
  assert.throws(() => run(dir, out), /looks like it contains a credential/);
  assert.equal(existsSync(out), false, "no index is written when the guard fires");
});
