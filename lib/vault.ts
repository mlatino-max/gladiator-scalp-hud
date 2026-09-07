/* Read the vault index. Two sources:
   - the file baked in at build time by scripts/fetch-vault.mjs (Vercel,
     CI): `content/vault/index.json`;
   - when VAULT_INDEX_PATH is set (the local Docker stack), a file the
     container regenerates from the bind-mounted vault every few minutes,
     re-read whenever its mtime changes. Pages that call this are rendered
     per request, so a vault edit shows up without a rebuild. */
import fs from "node:fs";
import bundled from "../content/vault/index.json";
import { marked } from "marked";

export type VaultNote = { path: string; slug: string; title: string; folder: string; date: string | null; tags: string[]; body: string };
export type VaultTicket = { path: string; date: string | null; symbol: string | null; ticket: Record<string, unknown> };
type Index = { generatedAt: string | null; notes: VaultNote[]; tickets: VaultTicket[]; skipped: number; source: string; repo?: string; ref?: string };

let cache: { file: string; mtime: number; index: Index } | null = null;

export function vault(): Index {
  const file = process.env.VAULT_INDEX_PATH;
  if (!file) return bundled as unknown as Index;
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (cache && cache.file === file && cache.mtime === mtime) return cache.index;
    const index = JSON.parse(fs.readFileSync(file, "utf8")) as Index;
    cache = { file, mtime, index };
    return index;
  } catch {
    /* not written yet (first seconds of a container) or mid-rewrite: the
       last good index, else the bundled one, labelled so /ops can say so */
    if (cache) return cache.index;
    return { ...(bundled as unknown as Index), source: "index-missing" };
  }
}
export function noteBySlug(slug: string): VaultNote | undefined { return vault().notes.find(n => n.slug === slug); }
export function notesByFolder(prefix: string): VaultNote[] { return vault().notes.filter(n => n.folder === prefix || n.folder.startsWith(prefix + "/")); }
export function dailyNote(date: string): VaultNote | undefined {
  return vault().notes.find(n => n.folder.startsWith("Journal") && (n.date === date || n.path.includes(date)));
}
export function ticketsFor(date: string): VaultTicket[] { return vault().tickets.filter(t => t.date === date); }

/* wikilinks become links to published notes, or plain text; Obsidian-only
   blocks (dataview, dataviewjs) are shown as code, never executed */
export function renderMarkdown(md: string): string {
  const slugs = new Map(vault().notes.map(n => [n.title.toLowerCase(), n.slug]));
  const src = md
    .replace(/```dataviewjs?[\s\S]*?```/g, m => "```text\n" + m.replace(/```/g, "") + "\n```")
    .replace(/!\[\[([^\]]+)\]\]/g, (_m, t) => `_(embed: ${t})_`)
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => {
      const slug = slugs.get(String(target).toLowerCase());
      const text = label || target;
      return slug ? `[${text}](/playbook/${slug})` : text;
    });
  return marked.parse(src, { async: false }) as string;
}
