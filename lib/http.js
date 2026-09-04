/* Request plumbing for the Next.js route handlers: GET-only, optional
   token (header or httpOnly cookie), no-store, structured errors.
   There is no order route and none may be added here. */
"use strict";

const COOKIE = "hud_token";

function tokenOk(req) {
  const want = process.env.HUD_ACCESS_TOKEN;
  if (!want) return true;
  const got = req.headers.get("x-hud-token") || cookie(req, COOKIE);
  return got === want;
}
function cookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
function cronOk(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...(extra || {}) }
  });
}

/* wrap a handler(req) → body|Response; enforces GET + token */
function guard(fn, opts) {
  opts = opts || {};
  return async (req, ctx) => {
    if (req.method !== "GET") return json({ error: "GET only — this API is read-only by design" }, 405);
    if (opts.cron ? !cronOk(req) : !tokenOk(req)) {
      return json({ error: opts.cron ? "bad or missing cron authorization" : "missing or bad x-hud-token" }, 401);
    }
    try {
      const out = await fn(req, ctx);
      return out instanceof Response ? out : json(out, 200);
    } catch (e) {
      return json({ error: String((e && e.message) || e), hint: e && e.hint }, (e && e.status) || 500);
    }
  };
}

module.exports = { COOKIE, tokenOk, cookie, cronOk, json, guard };
