"use client";
/* Evidence layer: one fetch of /api/evidence shared by the deck, lab,
   scoreboard, trades and regime pages. Every number is the engine's. */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet } from "./HudProvider";
import { E, fm, fpf, fdate } from "@/lib/engine-client";
import { Kpi, Pill } from "./ui";
import type { Evidence, RoundTrip, Stats, RegimeSnapshot } from "@/lib/types";

type Ev = { data: Evidence | null; error: string | null; status: number | null; loading: boolean; refresh: () => Promise<void>; asOf: string | null };
const Ctx = createContext<Ev | null>(null);

export function EvidenceProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Evidence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setData(await apiGet<Evidence>("/api/evidence?days=365")); setError(null); setStatus(null); }
    catch (e) { const err = e as Error & { status?: number }; setError(err.message); setStatus(err.status ?? null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); const id = setInterval(() => void refresh(), 300_000); return () => clearInterval(id); }, [refresh]);
  return <Ctx.Provider value={{ data, error, status, loading, refresh, asOf: data?.asOf ?? null }}>{children}</Ctx.Provider>;
}
export function useEvidence(): Ev {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEvidence outside EvidenceProvider");
  return v;
}

export function EvidenceError() {
  const { error, status, data } = useEvidence();
  if (!error) return null;
  return <div className="err-banner" role="alert"><b>EVIDENCE ERROR — no numbers shown</b>/api/evidence → {status ?? "network"}: {error}
    <div className="muted">last good: {data ? new Date(data.asOf).toLocaleTimeString() : "never this session"}</div></div>;
}
export function Pending({ what }: { what: string }) {
  const { error, loading } = useEvidence();
  if (error && !loading) return null;
  return <div className="muted mono">loading {what}…</div>;
}
export function EvidenceHeader({ title, sub }: { title: string; sub: string }) {
  const { data, loading, refresh } = useEvidence();
  return <div className="view-head"><div><h2>{title}</h2><p>{sub}</p></div>
    <div className="row">
      <div className="tabs" style={{ margin: 0, borderBottom: 0, flexWrap: "nowrap" }}><TabLink href="/evidence">Gate</TabLink><TabLink href="/evidence/trades">Trades</TabLink><TabLink href="/evidence/regime">Regime</TabLink></div>
      <button className="icon-btn" onClick={() => void refresh()}>{loading ? "⟳" : "REFRESH"}</button>
      <span className="muted mono">{data ? `as of ${new Date(data.asOf).toLocaleTimeString()} · store ${data.store}` : ""}</span>
    </div></div>;
}
function TabLink({ href, children }: { href: string; children: React.ReactNode }) {
  const on = typeof window !== "undefined" && window.location.pathname === href;
  return <Link href={href} className={on ? "on" : ""}>{children}</Link>;
}

export const BREACH_LABEL: Record<string, string> = {
  NO_STOP: "no bracket stop", MANUAL_EXIT: "manual exit", SECOND_TRADE: "second trade in day",
  OUTSIDE_WINDOW: "entry outside window", OVERSIZED: "oversized risk", HELD_OVERNIGHT: "held overnight"
};
export function BreachPills({ codes }: { codes: string[] | undefined }) {
  if (!codes || !codes.length) return <Pill kind="go">CLEAN</Pill>;
  return <>{codes.map(c => <Pill key={c} kind="no" title={BREACH_LABEL[c] || c}>{c}</Pill>)}</>;
}
function statusOf(r: RoundTrip): { kind: string; label: string; excluded: boolean } {
  if (r.reason === "open") return { kind: "dim", label: "OPEN", excluded: true };
  if (r.reason === "partial") return { kind: "dim", label: "PARTIAL", excluded: true };
  if (r.r == null && r.stop == null) return { kind: "mid", label: "NO STOP", excluded: true };
  if (r.r == null) return { kind: "mid", label: "NO R", excluded: true };
  return { kind: "go", label: "COUNTED", excluded: false };
}

/* ---------------- scoreboard ---------------- */
export function Scoreboard({ stats }: { stats: Stats }) {
  const v = E.RULES.validation;
  const val = (g: Stats["gates"][number]) => g.key === "pf" ? fpf(g.value) : g.key === "avgR" ? (g.value >= 0 ? "+" : "") + g.value.toFixed(3) + "R" : g.key === "maxDD" ? g.value.toFixed(1) + "%" : String(g.value);
  const thr = (g: Stats["gates"][number]) => `${g.op} ${g.key === "avgR" ? "+" + g.threshold + "R" : g.key === "maxDD" ? g.threshold + "%" : g.threshold}`;
  return <div>
    <div className={"verdict-big " + (stats.goLive ? "met" : "notmet")}>{stats.verdict}{stats.goLive ? " — DISCUSS GOING LIVE" : " — STAY PAPER"}</div>
    <div className="grid g5" style={{ marginTop: 12 }}>
      {stats.gates.map(g => <Kpi key={g.key} label={g.label.toUpperCase()} value={<>{g.pass ? "✓ " : "✗ "}{val(g)}</>}
        sub={<>{thr(g)}{g.noise ? ` · noise (n<${v.minTrades})` : ""}</>} tone={g.noise ? "noise" : g.pass ? "ok" : "bad"} title={g.noise ? "shown, but not evidence until n ≥ 40" : ""} />)}
    </div>
    <div className="grid g3" style={{ marginTop: 12 }}>
      <Kpi label="TIER" value={stats.tier.tier} sub={stats.tier.note} tone="gold" />
      <Kpi label="COUNTED / EXCLUDED" value={`n = ${stats.n}`} sub={`${stats.excluded.total} excluded: no stop ${stats.excluded.noStop} · partial ${stats.excluded.partial} · open ${stats.excluded.open}${stats.excluded.badR ? " · no R " + stats.excluded.badR : ""}`} />
      <Kpi label="WIN RATE" value={stats.n ? (stats.winRate * 100).toFixed(0) + "%" : "—"} sub={`breach window: last ${stats.windowSize} flat trades${stats.mixedRuleVersions ? " · mixed rule versions" : ""}`} tone={stats.n < v.minTrades ? "noise" : ""} />
    </div>
    {Object.keys(stats.breachCounts).length ? <div className="warn-banner" style={{ marginTop: 12 }}>Breaches in window: {Object.entries(stats.breachCounts).map(([k, n]) => `${k} ×${n}`).join(" · ")}</div> : null}
  </div>;
}

/* ---------------- equity + drawdown curve (inline SVG) ---------------- */
export function EquityCurve({ stats, entries, snapshots }: { stats: Stats; entries: RoundTrip[]; snapshots: Record<string, RegimeSnapshot> }) {
  const [mode, setMode] = useState<"R" | "$">("R");
  const counted = entries.filter(e => e.src === "alpaca" && e.r != null && E.isFlat(e)).slice().reverse();
  const excluded = entries.filter(e => e.src === "alpaca" && !(e.r != null && E.isFlat(e)));
  const path = mode === "R" ? stats.rPath : stats.pnlPath;
  const W = 900, H = 300, L = 48, R = 16, T = 28, B = 36;
  const n = path.length;
  const xs = (i: number) => L + (n > 1 ? i / (n - 1) : 0.5) * (W - L - R);
  const min = Math.min(0, ...path), max = Math.max(0, ...path);
  const span = Math.max(1e-9, max - min);
  const ys = (v: number) => T + (1 - (v - min) / span) * (H - T - B);
  const line = path.map((v, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(" ");
  /* drawdown from running peak */
  let peak = path[0] ?? 0; const dd: number[] = [];
  path.forEach(v => { if (v > peak) peak = v; dd.push(peak - v); });
  const ddArea = path.length > 1 ? "M" + path.map((v, i) => { let p = 0; for (let k = 0; k <= i; k++) p = Math.max(p, path[k]); return `${xs(i).toFixed(1)},${ys(p).toFixed(1)}`; }).join(" L") +
    " L" + path.slice().reverse().map((v, ri) => { const i = n - 1 - ri; return `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`; }).join(" L") + " Z" : "";
  const maxDDIdx = dd.indexOf(Math.max(...dd));
  const ticks = 4;
  const regimeColor = (r: string) => r === "GREEN" ? "#39ff9a" : r === "YELLOW" ? "#ffe14a" : r === "RED" ? "#ff3b5c" : "#3a4a58";
  return <div>
    <div className="row" style={{ justifyContent: "space-between" }}>
      <h3 style={{ margin: 0 }}>CUMULATIVE {mode === "R" ? "R" : "P&L ($)"} · {counted.length} counted · {excluded.length} excluded</h3>
      <div className="tabs" style={{ margin: 0, borderBottom: 0 }}><button className={mode === "R" ? "on" : ""} onClick={() => setMode("R")}>R</button><button className={mode === "$" ? "on" : ""} onClick={() => setMode("$")}>$</button></div>
    </div>
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`cumulative ${mode} over ${counted.length} trades with drawdown shading`}>
      {Array.from({ length: ticks + 1 }, (_, i) => { const v = min + (span * i) / ticks; return <g key={i}><line x1={L} x2={W - R} y1={ys(v)} y2={ys(v)} stroke="rgba(0,232,255,.08)" /><text x={4} y={ys(v) + 3}>{mode === "R" ? v.toFixed(1) : v.toFixed(0)}</text></g>; })}
      <line x1={L} x2={W - R} y1={ys(0)} y2={ys(0)} stroke="rgba(126,160,184,.5)" strokeDasharray="3 3" />
      {counted.map((e, i) => <rect key={e.id} x={xs(i + 1) - 3} y={T - 10} width={6} height={5} fill={regimeColor(e.regime || "UNKNOWN")} opacity={0.9}><title>{e.date} {e.regime || "UNKNOWN"}</title></rect>)}
      {ddArea ? <path d={ddArea} fill="rgba(255,59,92,.18)" stroke="none" /> : null}
      <path d={line} fill="none" stroke="#00e8ff" strokeWidth={2} style={{ filter: "drop-shadow(0 0 6px #00e8ff)" }} />
      {path.map((v, i) => <circle key={i} cx={xs(i)} cy={ys(v)} r={3} fill={i === 0 ? "#7ea0b8" : v >= (path[i - 1] ?? 0) ? "#39ff9a" : "#ff3b5c"}><title>{i === 0 ? "start" : `${counted[i - 1]?.date} ${counted[i - 1]?.symbol} ${counted[i - 1]?.r}R`}</title></circle>)}
      {excluded.map((e, i) => <g key={e.id}><circle cx={L + 10 + i * 12} cy={H - 10} r={4} fill="none" stroke="#ffe14a" strokeWidth={1.5}><title>excluded: {e.date} {e.symbol} — {statusOf(e).label}</title></circle></g>)}
      {dd.length > 1 && Math.max(...dd) > 0 ? <text x={xs(maxDDIdx)} y={ys(path[maxDDIdx]) + 14} fill="#ff3b5c" textAnchor="middle">max DD {stats.maxDDPct.toFixed(1)}%</text> : null}
      <text x={W - R} y={H - 4} textAnchor="end">hollow gold = excluded (no R) · top band = regime at entry</text>
    </svg>
    <details style={{ marginTop: 8 }}><summary className="muted mono">table equivalent</summary>
      <div className="tbl-wrap"><table><thead><tr><th>#</th><th>DATE</th><th>SYM</th><th>R</th><th>CUM R</th><th>CUM $</th><th>REGIME</th></tr></thead><tbody>
        {counted.map((e, i) => <tr key={e.id}><td>{i + 1}</td><td>{e.date}</td><td>{e.symbol}</td><td className={(e.r ?? 0) > 0 ? "up" : "down"}>{fm(e.r)}</td><td>{fm(stats.rPath[i + 1])}</td><td>{fm(stats.pnlPath[i + 1])}</td><td>{e.regime}</td></tr>)}
      </tbody></table></div></details>
    {!snapshots || !Object.keys(snapshots).length ? <p className="muted" style={{ fontSize: 12 }}>No regime snapshots yet: the band reads UNKNOWN until the 09:40 UTC cron has run on a trading day.</p> : null}
  </div>;
}

/* ---------------- trades table + drill-down ---------------- */
export function TradeRow({ r }: { r: RoundTrip }) {
  const s = statusOf(r);
  return <div className="ticket-card"><b>{r.symbol}</b> {r.date} · qty {r.qty} · entry {fm(r.entry)} · stop {fm(r.stop)} · exit {fm(r.exit)} · R <b className={(r.r ?? 0) > 0 ? "up" : "down"}>{r.r == null ? "—" : r.r.toFixed(2)}</b> · {r.reason} <Pill kind={s.kind}>{s.label}</Pill></div>;
}
export function TradesTable({ data }: { data: Evidence }) {
  const [sel, setSel] = useState<RoundTrip | null>(null);
  const [f, setF] = useState({ regime: "", breach: "", status: "", from: "", to: "", sym: "" });
  const [sort, setSort] = useState<{ k: keyof RoundTrip | "status"; d: 1 | -1 }>({ k: "date", d: -1 });
  const rows = useMemo(() => {
    let l = data.entries.filter(e => e.src === "alpaca");
    if (f.regime) l = l.filter(e => (e.regime || "UNKNOWN") === f.regime);
    if (f.breach === "clean") l = l.filter(e => !e.breaches?.length);
    else if (f.breach) l = l.filter(e => e.breaches?.includes(f.breach));
    if (f.status === "counted") l = l.filter(e => !statusOf(e).excluded);
    else if (f.status === "excluded") l = l.filter(e => statusOf(e).excluded);
    if (f.from) l = l.filter(e => e.date >= f.from);
    if (f.to) l = l.filter(e => e.date <= f.to);
    if (f.sym) l = l.filter(e => e.symbol.includes(f.sym.toUpperCase()));
    const get = (e: RoundTrip) => sort.k === "status" ? statusOf(e).label : (e[sort.k] as unknown as string | number | null);
    return l.slice().sort((a, b) => { const x = get(a), y = get(b); if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * sort.d; });
  }, [data, f, sort]);
  const counted = rows.filter(e => !statusOf(e).excluded).length;
  const th = (k: typeof sort.k, label: string) => <th onClick={() => setSort(s => ({ k, d: s.k === k ? (s.d === 1 ? -1 : 1) : -1 }))}>{label}{sort.k === k ? (sort.d === 1 ? " ▲" : " ▼") : ""}</th>;
  const breachOptions = [...new Set(data.entries.flatMap(e => e.breaches || []))];
  return <div>
    <div className="filters">
      <div><label>SYMBOL</label><input value={f.sym} onChange={e => setF({ ...f, sym: e.target.value })} placeholder="any" /></div>
      <div><label>FROM</label><input type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></div>
      <div><label>TO</label><input type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></div>
      <div><label>REGIME</label><select value={f.regime} onChange={e => setF({ ...f, regime: e.target.value })}><option value="">any</option>{["GREEN", "YELLOW", "RED", "UNKNOWN"].map(r => <option key={r}>{r}</option>)}</select></div>
      <div><label>BREACH</label><select value={f.breach} onChange={e => setF({ ...f, breach: e.target.value })}><option value="">any</option><option value="clean">clean only</option>{breachOptions.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
      <div><label>STATUS</label><select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">all</option><option value="counted">counted</option><option value="excluded">excluded</option></select></div>
    </div>
    <div className="panel tbl-wrap">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <span className="mono">{rows.length} round trips · <b className="up">{counted} counted</b> · <b style={{ color: "var(--yellow)" }}>{rows.length - counted} excluded</b> (greyed, with reason)</span>
        {data.cache?.drift ? <Pill kind="mid" title="the persisted journal cache disagrees with this fresh reconstruction; the fresh one is shown">CACHE DRIFT</Pill> : null}
      </div>
      <table>
        <thead><tr>{th("date", "DATE")}{th("symbol", "SYM")}{th("entry", "ENTRY")}{th("stop", "STOP")}{th("exit", "EXIT")}{th("qty", "QTY")}{th("r", "R")}{th("reason", "EXIT REASON")}{th("status", "STATUS")}{th("regime", "REGIME")}<th>BREACHES</th><th>DAY</th></tr></thead>
        <tbody>{rows.length ? rows.map(e => { const s = statusOf(e); return <tr key={e.id} className={"click" + (s.excluded ? " excluded" : "") + (sel?.id === e.id ? " sel" : "")} onClick={() => setSel(e)}>
          <td>{e.date}{e.exitDate && e.exitDate !== e.date ? <span className="muted"> → {e.exitDate}</span> : null}</td><td>{e.symbol}</td>
          <td>{fm(e.entry)}</td><td>{fm(e.stop)}</td><td>{fm(e.exit)}</td><td>{e.qty}</td>
          <td className={(e.r ?? 0) > 0 ? "up" : (e.r ?? 0) < 0 ? "down" : ""}>{e.r == null ? "—" : e.r.toFixed(2)}</td>
          <td>{e.reason}</td><td><Pill kind={s.kind}>{s.label}</Pill></td><td><Pill kind={e.regime || "UNKNOWN"}>{e.regime || "UNKNOWN"}</Pill></td>
          <td><BreachPills codes={e.breaches} /></td><td><Link href={`/journal/${e.date}`} onClick={ev => ev.stopPropagation()}>note</Link></td>
        </tr>; }) : <tr><td colSpan={12} className="muted">No fills in range — an empty journal is honest.</td></tr>}</tbody>
      </table>
    </div>
    {sel ? <Drawer r={sel} onClose={() => setSel(null)} snapshots={data.regime.snapshots} /> : null}
  </div>;
}
function Drawer({ r, onClose, snapshots }: { r: RoundTrip; onClose: () => void; snapshots: Record<string, RegimeSnapshot> }) {
  const s = statusOf(r);
  const risk = r.entry != null && r.stop != null ? r.entry - r.stop : null;
  const snap = snapshots[r.date];
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  return <div className="drawer" role="dialog" aria-label={`round trip ${r.symbol} ${r.date}`}>
    <div className="row" style={{ justifyContent: "space-between" }}><h3>{r.symbol} · {r.date} <Pill kind={s.kind}>{s.label}</Pill></h3><button className="icon-btn" onClick={onClose}>✕</button></div>
    <div className="grid g2e">
      <Kpi label="ENTRY" value={fm(r.entry)} sub={fdate(r.entryAt) + " ET"} /><Kpi label="STOP" value={fm(r.stop)} tone={r.stop == null ? "bad" : ""} sub={r.stop == null ? "no bracket stop → no R, ever" : ""} />
      <Kpi label="EXIT" value={fm(r.exit)} sub={r.exitAt ? fdate(r.exitAt) + " ET · " + r.reason : r.reason} /><Kpi label="R" value={r.r == null ? "—" : r.r.toFixed(3)} tone={(r.r ?? 0) > 0 ? "ok" : r.r == null ? "" : "bad"} sub={r.pnl != null ? `$${fm(r.pnl)}` : ""} />
    </div>
    <div className="panel" style={{ marginTop: 12 }}><h3>HAND CHECK</h3>
      <div className="code">{`r = (exit − entry) / (entry − stop)\n  = (${fm(r.exit, 4)} − ${fm(r.entry, 4)}) / (${fm(r.entry, 4)} − ${fm(r.stop, 4)})\n  = ${r.exit != null && r.entry != null ? fm(r.exit - r.entry, 4) : "—"} / ${risk == null ? "—" : fm(risk, 4)}\n  = ${r.r == null ? "null (excluded)" : r.r.toFixed(3)}`}</div>
      <p className="muted" style={{ fontSize: 12 }}>Compute this by hand against the broker feed once per release. Two independent paths, same answer.</p></div>
    <div className="panel"><h3>FILLS · FIFO LOT MATCHING</h3>
      <div className="tbl-wrap"><table><thead><tr><th>SIDE</th><th>KIND</th><th>QTY</th><th>PRICE</th><th>TIME ET</th><th>ORDER ID</th></tr></thead><tbody>
        {(r.fills || []).map((f, i) => <tr key={f.id + i}><td>{f.side.toUpperCase()}</td><td>{f.kind}</td><td>{f.qty}</td><td>{fm(f.price)}</td><td>{fdate(f.at)}</td><td className="muted" style={{ fontSize: 10 }}>{f.id}</td></tr>)}
      </tbody></table></div>
      <p className="muted" style={{ fontSize: 12 }}>matched {r.matchedQty} of {r.qty} · exits: {r.exitKinds?.join(", ") || "none"} · a bracket leg closes its own parent; standalone sells close the oldest lot first</p></div>
    <div className="panel"><h3>BREACHES (rules v{r.breachRulesVersion})</h3><BreachPills codes={r.breaches} />
      {r.breaches?.length ? <ul className="muted" style={{ fontSize: 12 }}>{r.breaches.map(c => <li key={c}>{c}: {BREACH_LABEL[c]}</li>)}</ul> : null}</div>
    <div className="panel"><h3>REGIME AT ENTRY</h3><Pill kind={r.regime || "UNKNOWN"}>{r.regime || "UNKNOWN"}</Pill> {snap ? <span className="muted mono"> SPY {fm(snap.spyClose)} vs SMA20 {fm(snap.sma20)} / SMA50 {fm(snap.sma50)} · breadth {snap.breadth == null ? "—" : fm(snap.breadth)} · {snap.source}</span> : <span className="muted"> no snapshot for {r.date} (never backfilled)</span>}</div>
    <div className="row"><Link className="btn ghost" href={`/journal/${r.date}`}>DAILY NOTE + TICKET</Link></div>
  </div>;
}

/* ---------------- regime + gate-block breakdown ---------------- */
export function RegimeView({ data }: { data: Evidence }) {
  const snaps = Object.values(data.regime.snapshots).sort((a, b) => (a.date < b.date ? 1 : -1));
  return <div>
    <div className="grid g2e">
      <div className="panel"><h3>RESULTS BY REGIME (regime at entry, from the daily snapshot)</h3>
        <div className="tbl-wrap"><table><thead><tr><th>REGIME</th><th>n</th><th>PF</th><th>AVG R</th><th>WIN</th></tr></thead><tbody>
          {data.regime.breakdown.map(b => <tr key={b.regime}><td><Pill kind={b.regime}>{b.regime}</Pill></td><td>{b.n}</td><td>{b.n ? fpf(b.pf) : "—"}</td><td>{b.n ? (b.avgR >= 0 ? "+" : "") + b.avgR.toFixed(3) : "—"}</td><td>{b.n ? (b.winRate * 100).toFixed(0) + "%" : "—"}</td></tr>)}
        </tbody></table></div>
        <p className="muted" style={{ fontSize: 12 }}>UNKNOWN = trades before the snapshot cron started. Never hidden, never backfilled. Splits with n &lt; 10 are noise.</p></div>
      <div className="panel"><h3>WHY NO TRADE — first blocking gate on NO_TRADE days</h3>
        <div className="grid g3"><Kpi label="DAYS SNAPSHOTTED" value={data.gateBlocks.days} /><Kpi label="NO-TRADE DAYS" value={data.gateBlocks.noTradeDays} /><Kpi label="TOP BLOCKER" value={data.gateBlocks.blockers[0]?.gate ?? "—"} tone="warn" /></div>
        <div className="tbl-wrap" style={{ marginTop: 8 }}><table><thead><tr><th>GATE</th><th>DAYS</th><th></th></tr></thead><tbody>
          {data.gateBlocks.blockers.map(b => <tr key={b.gate}><td>{b.gate}</td><td>{b.days}</td><td><div className="bar"><i style={{ width: `${data.gateBlocks.noTradeDays ? (b.days / data.gateBlocks.noTradeDays) * 100 : 0}%` }} /></div></td></tr>)}
          {!data.gateBlocks.blockers.length ? <tr><td colSpan={3} className="muted">no verdict snapshots yet — captured while the entry window is open, on each scan</td></tr> : null}
        </tbody></table></div></div>
    </div>
    <div className="panel"><h3>REGIME SNAPSHOTS</h3>
      <div className="tbl-wrap"><table><thead><tr><th>DATE</th><th>REGIME</th><th>SPY</th><th>SMA20</th><th>SMA50</th><th>BREADTH</th><th>SOURCE</th><th>CAPTURED</th></tr></thead><tbody>
        {snaps.length ? snaps.map(s => <tr key={s.date}><td>{s.date}</td><td><Pill kind={s.regime}>{s.regime}</Pill></td><td>{fm(s.spyClose)}</td><td>{fm(s.sma20)}</td><td>{fm(s.sma50)}</td><td>{s.breadth == null ? "—" : fm(s.breadth)}</td><td>{s.source}</td><td className="muted">{s.capturedAt ? new Date(s.capturedAt).toLocaleString() : ""}</td></tr>)
          : <tr><td colSpan={8} className="muted">none yet — the regime-snapshot cron runs 14:40 UTC on trading days</td></tr>}
      </tbody></table></div></div>
    <div className="panel"><h3>VERDICT DAYS</h3>
      <div className="tbl-wrap"><table><thead><tr><th>DATE</th><th>VERDICT</th><th>TOP</th><th>FIRST BLOCK</th><th>LAST CAPTURE</th></tr></thead><tbody>
        {data.verdictDays.slice().reverse().map(v => <tr key={v.date}><td>{v.date}</td><td><Pill kind={v.verdict === "TRADE_ARMED" ? "go" : v.verdict === "STAGED" ? "mid" : "no"}>{v.verdict}</Pill></td><td>{v.top ?? "—"}</td><td>{v.firstBlock ?? "—"}</td><td className="muted">{v.at ? new Date(v.at).toLocaleTimeString() : ""}</td></tr>)}
        {!data.verdictDays.length ? <tr><td colSpan={5} className="muted">none yet</td></tr> : null}
      </tbody></table></div></div>
  </div>;
}
