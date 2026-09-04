/* GET /api/ops — what preflight.py checks, from inside the deployment. */
import { guard } from "../../../lib/http.js";
import { opsStatus } from "../../../lib/services.js";
export const dynamic = "force-dynamic";
export const GET = guard(async () => opsStatus());
