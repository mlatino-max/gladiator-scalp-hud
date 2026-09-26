/* cron → GET /api/cron/screen-load (18:30 ET weekdays). Fills bars_daily
   from Massive's grouped daily for the last eight sessions and keeps the
   symbols reference current (Supabase plan, phase 2). ?force=1 reloads
   sessions already present; ?reference=1 refreshes the reference now. */
import { guard } from "../../../../lib/http.js";
import { loadBars } from "../../../../lib/screen.js";
import { STRATEGY } from "../../../../lib/services.js";
import { evaluate } from "../../../../lib/alerts.js";
export const dynamic = "force-dynamic";
export const maxDuration = 900;
export const GET = guard(async (req) => {
  const q = new URL(req.url).searchParams;
  try {
    return await loadBars({ force: q.get("force") === "1", reference: q.get("reference") === "1" });
  } catch (e) {
    await evaluate(STRATEGY, { plumbing: { key: "screen-load", value: String(e.message).slice(0, 80), detail: "screen load failed: " + e.message } }).catch(() => {});
    throw e;
  }
}, { cron: true });
