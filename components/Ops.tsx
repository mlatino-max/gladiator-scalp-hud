"use client";
import React, { useEffect, useState } from "react";
import { useHud, apiGet } from "./HudProvider";
import { ErrorPanel, Kpi } from "./ui";

type Ops = {
  asOf: string; store: string; storePing?: boolean; storeError?: string; tokenEnforced: boolean; cronSecret: boolean; alerts: boolean;
  feed: string; tradingBase: string; paper: boolean; equityCap: number; vaultToken: boolean;
  cron: { regime: Record<string, unknown> | null; journal: Record<string, unknown> | null };
  account: { ok: boolean; number?: string; status?: string; error?: string; hint?: string };
};

export default function OpsConsole({ vault }: { vault: { generatedAt: string | null; notes: number; tickets: number; skipped: number; source: string } }) {
  const { refresh, errors, lastOk, state } = useHud();
  const [token, setToken] = useState("");
  const [session, setSession] = useState<{ enforced: boolean; hasCookie: boolean } | null>(null);
  const [msg, setMsg] = useState("");
  const [ops, setOps] = useState<Ops | null>(null);
  const [opsErr, setOpsErr] = useState<string | null>(null);
  const loadOps = async () => {
    try { setOps(await apiGet<Ops>("/api/ops")); setOpsErr(null); } catch (e) { setOpsErr(String((e as Error).message)); }
  };
  useEffect(() => { void apiGet<{ enforced: boolean; hasCookie: boolean }>("/api/session").then(setSession).catch(() => {}); void loadOps(); }, []);
  const connect = async () => {
    setMsg("…");
    const r = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
    const j = await r.json();
    setMsg(r.ok ? "token accepted — stored as an httpOnly cookie in this browser" : `rejected: ${j.error}`);
    setToken("");
    if (r.ok) { await refresh(); await loadOps(); void apiGet<{ enforced: boolean; hasCookie: boolean }>("/api/session").then(setSession); }
  };
  const disconnect = async () => { await fetch("/api/session", { method: "DELETE" }); setMsg("cookie cleared"); await refresh(); };
  const cron = (r: Record<string, unknown> | null) => r ? `${r.ok ? "ok" : "FAIL"} · ${r.finished ?? r.started}${r.skipped ? " · " + r.skipped : ""}` : "never ran";
  return <section className="view">
    <div className="view-head"><div><h2>OPS CONSOLE</h2><p>What preflight.py checks, from inside — plus commands and links. No order fire from here.</p></div></div>
    <ErrorPanel errors={errors} lastOk={lastOk} />
    <div className="grid g2e">
      <div className="panel">
        <h3>DATA LINK</h3>
        <div className="row">
          <div style={{ flex: 1 }}><label>HUD TOKEN (only if HUD_ACCESS_TOKEN is set)</label><input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder={session?.enforced ? (session.hasCookie ? "cookie present" : "required") : "not enforced"} /></div>
          <div><label>&nbsp;</label><button className="btn" onClick={() => void connect()}>CONNECT</button></div>
          <div><label>&nbsp;</label><button className="btn ghost" onClick={() => void disconnect()}>CLEAR</button></div>
        </div>
        <div className="ticket-card" style={{ marginTop: 8 }}>
          state <b style={{ color: state === "LIVE" ? "var(--ok)" : state === "STALE" ? "var(--orange)" : "var(--bad)" }}>{state}</b> · token enforced: <b>{session ? String(session.enforced) : "—"}</b> · cookie: <b>{session ? String(session.hasCookie) : "—"}</b><br />{msg}
        </div>
        <p className="muted" style={{ fontSize: 12 }}>The token is never stored in localStorage or a URL. Vercel Authentication sits in front of every page; this cookie only unlocks the read-only API routes for this browser.</p>
      </div>
      <div className="panel">
        <h3>PREFLIGHT</h3>
        {opsErr ? <div className="err-banner"><b>/api/ops</b>{opsErr}</div> : null}
        {ops ? <div className="grid g2e">
          <Kpi label="ACCOUNT" value={ops.account.ok ? ops.account.number : "FAIL"} sub={ops.account.ok ? ops.account.status : ops.account.error} tone={ops.account.ok ? (ops.paper ? "ok" : "bad") : "bad"} />
          <Kpi label="MODE" value={ops.paper ? "PAPER" : "LIVE"} sub={ops.tradingBase} tone={ops.paper ? "ok" : "bad"} />
          <Kpi label="TOKEN ENFORCED" value={ops.tokenEnforced ? "YES" : "NO"} tone={ops.tokenEnforced ? "ok" : "warn"} />
          <Kpi label="STORE" value={ops.store.toUpperCase()} sub={ops.storePing ? "ping ok" : ops.storeError || "no ping"} tone={ops.store === "kv" && ops.storePing ? "ok" : "warn"} />
          <Kpi label="CRON SECRET" value={ops.cronSecret ? "SET" : "MISSING"} tone={ops.cronSecret ? "ok" : "warn"} />
          <Kpi label="ALERTS" value={ops.alerts ? "ON" : "OFF"} tone={ops.alerts ? "ok" : "warn"} />
          <Kpi label="EQUITY CAP" value={"$" + ops.equityCap} tone="gold" />
          <Kpi label="FEED" value={ops.feed.toUpperCase()} />
        </div> : <div className="muted mono">loading…</div>}
        {ops?.account.hint ? <div className="warn-banner" style={{ marginTop: 10 }}>{ops.account.hint}</div> : null}
      </div>
    </div>
    <div className="grid g2e">
      <div className="panel">
        <h3>CRON JOBS (UTC, DST-safe: after the open / after the close in both EDT and EST)</h3>
        <table><tbody>
          <tr><td>regime-snapshot</td><td>14:40 UTC Mon–Fri</td><td>{ops ? cron(ops.cron.regime) : "—"}</td></tr>
          <tr><td>journal-sync</td><td>21:15 UTC Mon–Fri</td><td>{ops ? cron(ops.cron.journal) : "—"}</td></tr>
        </tbody></table>
        <p className="muted" style={{ fontSize: 12 }}>Vercel Hobby allows two daily crons. Both run unattended; pages also re-fetch on load and via the DATA chip.</p>
      </div>
      <div className="panel">
        <h3>VAULT INDEX (build time)</h3>
        <table><tbody>
          <tr><td>source</td><td>{vault.source}</td></tr>
          <tr><td>generated</td><td>{vault.generatedAt ?? "—"}</td></tr>
          <tr><td>published notes</td><td>{vault.notes}</td></tr>
          <tr><td>tickets</td><td>{vault.tickets}</td></tr>
          <tr><td>skipped (no publish: true)</td><td>{vault.skipped}</td></tr>
          <tr><td>token configured</td><td>{ops ? String(ops.vaultToken) : "—"}</td></tr>
        </tbody></table>
      </div>
    </div>
    <div className="grid g2e">
      <div className="panel">
        <h3>DAILY LOOP (human-operated)</h3>
        <div className="code">{`python bot/scanner.py --equity 750
python bot/executor.py --ticket bot/tickets/ticket_DATE.json          # dry run
python bot/executor.py --ticket bot/tickets/ticket_DATE.json --approve # PAPER
# LIVE (owner only): GLADIATOR_LIVE_CONFIRM=YES ... --approve --live`}</div>
      </div>
      <div className="panel link-grid">
        <h3>LINKS</h3>
        <a href="https://app.alpaca.markets" target="_blank" rel="noopener">Alpaca Dashboard</a>
        <a href="https://app.alpaca.markets/paper/dashboard" target="_blank" rel="noopener">Alpaca Paper Desk</a>
        <a href="https://www.tradingview.com" target="_blank" rel="noopener">TradingView</a>
        <a href="https://github.com/mlatino-max/gladiator-scalp-hud" target="_blank" rel="noopener">GitHub // gladiator-scalp-hud</a>
      </div>
    </div>
  </section>;
}
