/* Vercel Cron → GET /api/cron/journal-sync (21:15 UTC = 17:15 EDT / 16:15 EST).
   Reconstructs round trips from fills, persists the cache, evaluates alerts. */
import { guard } from "../../../../lib/http.js";
import { journalSync, STRATEGY } from "../../../../lib/services.js";
import { evaluate } from "../../../../lib/alerts.js";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const GET = guard(async () => {
  try {
    return await journalSync();
  } catch (e) {
    await evaluate(STRATEGY, { plumbing: { key: "journal-sync", value: String(e.message).slice(0, 80), detail: "journal sync failed: " + e.message } }).catch(() => {});
    throw e;
  }
}, { cron: true });
