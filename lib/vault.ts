/* Read the build-time vault index (scripts/fetch-vault.mjs). */
import index from "../content/vault/index.json";
import { marked } from "marked";

export type VaultNote = { path: string; slug: string; title: string; folder: string; date: string | null; tags: string[]; body: string };
export type VaultTicket = { path: string; date: string | null; symbol: string | null; ticket: Record<string, unknown> };
type Index = { generatedAt: string | null; notes: VaultNote[]; tickets: VaultTicket[]; skipped: number; source: string; repo?: string; ref?: string };

export function vault(): Index { return index as unknown as Index; }
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
