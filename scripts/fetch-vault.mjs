#!/usr/bin/env node
/* Build-time vault ingestion (spec §3.4).
   Fetches ONLY allowlisted folders from the vault repo, keeps ONLY notes
   whose frontmatter says `publish: true`, and FAILS THE BUILD if any kept
   note trips the confidential-name guard or looks like it contains a key.
   Writes content/vault/index.json. With no GITHUB_VAULT_TOKEN it writes an
   empty index and warns — the site builds, the playbook says "no published
   notes", and nothing private ever leaves the vault by accident. */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const REPO = process.env.VAULT_REPO || "mlatino-max/gladiator";
const REF = process.env.VAULT_REF || "master";
const TOKEN = process.env.GITHUB_VAULT_TOKEN;
const OUT = path.resolve("content/vault/index.json");
const ALLOW = (process.env.VAULT_ALLOWLIST || "TradeCenter,Projects/Trading,Journal/Daily,Graphify/CLAUDE CODE").split(",").map(s => s.trim()).filter(Boolean);
const TICKET_DIR = process.env.VAULT_TICKET_DIR || "Projects/Trading/SCALPER-HUD/bot/tickets";
const GUARD = /\b(Licensing|JDC|Juvenile)\b/;
const KEYISH = /\b(PK[A-Z0-9]{16,}|APCA-API-SECRET-KEY\s*[:=]\s*\S{20,}|sk-[A-Za-z0-9]{20,})\b/;

const headers = { accept: "application/vnd.github+json", "user-agent": "gladiator-scalp-hud-build" };
if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;

async function gh(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${url}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
async function tree() {
  const t = await gh(`https://api.github.com/repos/${REPO}/git/trees/${encodeURIComponent(REF)}?recursive=1`);
  if (t.truncated) console.warn("[vault] tree truncated by GitHub; allowlisted folders may be incomplete");
  return t.tree.filter(n => n.type === "blob");
}
async function raw(p) {
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${REF}/${p.split("/").map(encodeURIComponent).join("/")}`, { headers });
  if (!res.ok) throw new Error(`raw ${res.status} on ${p}`);
  return res.text();
}
function frontmatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { fm: {}, body: md };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { fm, body: md.slice(m[0].length) };
}
function allowed(p) { return ALLOW.some(a => p === a || p.startsWith(a.replace(/\/$/, "") + "/")); }

async function main() {
  await mkdir(path.dirname(OUT), { recursive: true });
  const index = { generatedAt: new Date().toISOString(), repo: REPO, ref: REF, allowlist: ALLOW, notes: [], tickets: [], skipped: 0, source: "github" };
  if (!TOKEN) {
    index.source = "no-token";
    console.warn("[vault] GITHUB_VAULT_TOKEN not set — writing an empty vault index");
    await writeFile(OUT, JSON.stringify(index, null, 2));
    return;
  }
  const blobs = await tree();
  const mdFiles = blobs.filter(b => b.path.endsWith(".md") && allowed(b.path));
  const ticketFiles = blobs.filter(b => b.path.startsWith(TICKET_DIR + "/") && b.path.endsWith(".json"));
  const violations = [];
  for (const b of mdFiles) {
    const md = await raw(b.path);
    const { fm, body } = frontmatter(md);
    if (String(fm.publish).toLowerCase() !== "true") { index.skipped++; continue; }
    if (GUARD.test(b.path) || GUARD.test(md)) violations.push(`${b.path}: confidential-name guard`);
    if (KEYISH.test(md)) violations.push(`${b.path}: looks like it contains a credential`);
    const title = fm.title || path.basename(b.path, ".md");
    index.notes.push({
      path: b.path, slug: b.path.replace(/\.md$/, "").replace(/[^A-Za-z0-9/_-]+/g, "-").toLowerCase(),
      title, folder: b.path.split("/").slice(0, -1).join("/"),
      date: fm.date || fm.created || (/(\d{4}-\d{2}-\d{2})/.exec(path.basename(b.path)) || [])[1] || null,
      tags: String(fm.tags || "").replace(/[\[\]]/g, "").split(",").map(s => s.trim()).filter(Boolean),
      body
    });
  }
  for (const b of ticketFiles) {
    try {
      const j = JSON.parse(await raw(b.path));
      const date = (/(\d{4}-\d{2}-\d{2})/.exec(path.basename(b.path)) || [])[1] || null;
      index.tickets.push({ path: b.path, date, symbol: j.symbol || null, ticket: j });
    } catch (e) { console.warn(`[vault] bad ticket ${b.path}: ${e.message}`); }
  }
  if (violations.length) {
    console.error("[vault] BUILD FAILED — published notes violate the guard:\n  " + violations.join("\n  "));
    process.exit(1);
  }
  await writeFile(OUT, JSON.stringify(index, null, 2));
  console.log(`[vault] ${index.notes.length} published notes, ${index.tickets.length} tickets, ${index.skipped} skipped (no publish: true)`);
}
main().catch(e => { console.error("[vault] " + e.message); process.exit(1); });
