/* Vercel Cron → GET /api/cron/regime-snapshot (14:40 UTC = 09:40 EDT / 10:40 EST).
   Records the day's regime once; never recomputed retroactively. */
import { guard } from "../../../../lib/http.js";
import { regimeSnapshot, STRATEGY } from "../../../../lib/services.js";
import { evaluate } from "../../../../lib/alerts.js";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const GET = guard(async (req) => {
  const force = new URL(req.url).searchParams.get("force") === "1";
  try {
    return await regimeSnapshot({ force });
  } catch (e) {
    await evaluate(STRATEGY, { plumbing: { key: "regime-snapshot", value: String(e.message).slice(0, 80), detail: "regime snapshot failed: " + e.message } }).catch(() => {});
    throw e;
  }
}, { cron: true });
