/* Login wall for every page. Vercel Authentication cannot cover production
   domains on this plan, so the HUD token gates the pages too, not only the
   API: no `hud_token` cookie (set once on /ops via POST /api/session) means
   a redirect to /ops. The API routes keep their own guard in lib/http.js,
   so /api/* passes straight through here — that keeps the cron routes and
   the session route reachable. With HUD_ACCESS_TOKEN unset nothing is
   enforced, exactly like the API. This file touches nothing at the broker. */
import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "hud_token";
const OPEN = ["/ops"];

export function proxy(req: NextRequest) {
  const want = process.env.HUD_ACCESS_TOKEN;
  if (!want) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (OPEN.includes(pathname)) return NextResponse.next();
  let got = req.cookies.get(COOKIE)?.value ?? "";
  try { got = decodeURIComponent(got); } catch { /* keep raw */ }
  if (got === want) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/ops";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|assets/|favicon.ico).*)"]
};
