/* The browser never stores the HUD token in localStorage. POST the token
   once; if it matches HUD_ACCESS_TOKEN it is set as an httpOnly, same-site
   cookie that the read-only API routes accept. DELETE clears it. This route
   touches nothing at the broker. */
import { COOKIE, json } from "../../../lib/http.js";
export const dynamic = "force-dynamic";

function setCookie(value, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
export async function POST(req) {
  const want = process.env.HUD_ACCESS_TOKEN;
  if (!want) return json({ ok: true, enforced: false, note: "HUD_ACCESS_TOKEN is not set; no token needed" });
  let body = {};
  try { body = await req.json(); } catch (e) { /* empty */ }
  const got = String((body && body.token) || "");
  if (got !== want) return json({ ok: false, error: "bad token" }, 401);
  return json({ ok: true, enforced: true }, 200, { "set-cookie": setCookie(got, 60 * 60 * 24 * 90) });
}
export async function DELETE() {
  return json({ ok: true }, 200, { "set-cookie": setCookie("", 0) });
}
export async function GET(req) {
  const want = process.env.HUD_ACCESS_TOKEN;
  const raw = req.headers.get("cookie") || "";
  const has = raw.split(";").some(p => p.trim().startsWith(`${COOKIE}=`));
  return json({ enforced: !!want, hasCookie: has });
}
