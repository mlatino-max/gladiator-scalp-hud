/* GET /api/journal[?days=180] — round trips reconstructed from real fills,
   with derived breach codes. Nothing typed by hand. */
import { guard } from "../../../lib/http.js";
import { journal } from "../../../lib/services.js";
export const dynamic = "force-dynamic";
export const GET = guard(async (req) => {
  const q = new URL(req.url).searchParams.get("days");
  const days = Math.min(365, Math.max(1, parseInt(q || "180", 10) || 180));
  return journal(days);
});
