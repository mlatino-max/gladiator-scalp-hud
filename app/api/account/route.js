/* GET /api/account — capped equity, weekly DD, cooling-off, tradedToday. Read-only. */
import { guard } from "../../../lib/http.js";
import { account } from "../../../lib/services.js";
export const dynamic = "force-dynamic";
export const GET = guard(async () => account());
