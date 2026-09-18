/* cron → GET /api/cron/screen (08:45 ET weekdays). Reads v_pullback_screen
   and records the run in screen_runs / screen_candidates before the
   pre-market routine (Supabase plan, phase 2). Read-only at the broker. */
import { guard } from "../../../../lib/http.js";
import { runScreen } from "../../../../lib/screen.js";
import { STRATEGY } from "../../../../lib/services.js";
import { evaluate } from "../../../../lib/alerts.js";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const GET = guard(async () => {
  try {
    return await runScreen({ record: true, notes: "cron" });
  } catch (e) {
    await evaluate(STRATEGY, { plumbing: { key: "screen", value: String(e.message).slice(0, 80), detail: "screen run failed: " + e.message } }).catch(() => {});
    throw e;
  }
}, { cron: true });
