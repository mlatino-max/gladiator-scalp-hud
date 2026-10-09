/* GET /api/flowstate[?symbol=QQQ] — live state for the Liquidity Drift
   panel: session, price structure, volatility, trend, book, performance,
   agents and recent closes. Read-only, token-guarded, cached 15 s server
   side. Every numeric field is a number or null. */
import { guard } from "../../../lib/http.js";
import { flowstate } from "../../../lib/flowstate.js";
export const dynamic = "force-dynamic";
export const GET = guard(async (req) => {
  const q = (new URL(req.url).searchParams.get("symbol") || "").trim().toUpperCase();
  return flowstate(/^[A-Z.]{1,6}$/.test(q) ? q : null);
});
