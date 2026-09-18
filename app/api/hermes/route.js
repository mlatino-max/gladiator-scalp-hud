/* GET /api/hermes          → the HERMES paper desk PNG (token-guarded)
   GET /api/hermes?meta=1   → { available, renderedAt, bytes, lastRun }
   Reads the file the `hermes` sidecar left on the data volume; nothing else. */
import { guard, json } from "../../../lib/http.js";
import { deskStatus, readDesk } from "../../../lib/hermes.js";
export const dynamic = "force-dynamic";

export const GET = guard(async (req) => {
  if (new URL(req.url).searchParams.has("meta")) return deskStatus();
  const png = readDesk();
  if (!png) return json({ error: "no HERMES desk rendered on this deployment", ...deskStatus() }, 404);
  return new Response(png, { status: 200, headers: { "content-type": "image/png", "cache-control": "no-store" } });
});
