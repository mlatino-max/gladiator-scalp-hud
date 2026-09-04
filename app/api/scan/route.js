/* GET /api/scan[?symbols=A,B] — live universe rows. Read-only. */
import { guard } from "../../../lib/http.js";
import { scan } from "../../../lib/services.js";
export const dynamic = "force-dynamic";
export const GET = guard(async (req) => {
  const extra = String(new URL(req.url).searchParams.get("symbols") || "").split(",").filter(Boolean);
  return scan(extra);
});
