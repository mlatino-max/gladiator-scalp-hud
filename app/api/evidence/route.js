/* GET /api/evidence[?days=365] — journal + breaches + regime + gate-block
   breakdown + the five-tile stats, all from one fresh reconstruction. */
import { guard } from "../../../lib/http.js";
import { evidence } from "../../../lib/services.js";
export const dynamic = "force-dynamic";
export const GET = guard(async (req) => {
  const q = new URL(req.url).searchParams.get("days");
  const days = Math.min(365, Math.max(1, parseInt(q || "365", 10) || 365));
  return evidence(days);
});
