/* GET /api/screen[?record=1] — the pullback screen from v_pullback_screen
   over the last eight loaded sessions. Read-only unless record=1, which
   books the run in screen_runs / screen_candidates (what the morning
   routine does when it runs from a local session). No broker call. */
import { guard } from "../../../lib/http.js";
import { runScreen } from "../../../lib/screen.js";
export const dynamic = "force-dynamic";
export const GET = guard(async (req) => {
  const q = new URL(req.url).searchParams;
  return runScreen({ record: q.get("record") === "1", notes: q.get("notes") || "on-demand" });
});
