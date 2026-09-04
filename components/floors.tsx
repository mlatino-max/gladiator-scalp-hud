"use client";
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useHud } from "./HudProvider";
import { E, fm } from "@/lib/engine-client";
import { ErrorPanel, GateList, Kpi, Loading, Pill, VerdictBanner } from "./ui";
import type { Row, Ticket } from "@/lib/types";

function Tabs({ tabs, tab, setTab }: { tabs: [string, string][]; tab: string; setTab: (t: string) => void }) {
  return <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>;
}
function Head({ title, sub, img }: { title: string; sub: string; img: string }) {
  return <div className="view-head"><div><h2>{title}</h2><p>{sub}</p></div>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className="emblem" src={img} alt="" /></div>;
}
const TIER_LBL = ["TRADEABLE", "PENDING DATA", "DISQUALIFIED"];

/* ---------------- FLOOR 1 · INGEST ---------------- */
export function Floor1() {
  const { scan, errors, lastOk, state } = useHud();
  const [tab, setTab] = useState("uni");
  const [q, setQ] = useState("");
  const [band, setBand] = useState(false);
  const list = useMemo(() => {
    if (!scan) return [];
    let l = E.rank(scan.rows);
    if (band) l = l.filter(E.inBand);
    if (q) l = l.filter(r => r.symbol.includes(q.toUpperCase()));
    return l;
  }, [scan, band, q]);
  return <section className="view">
    <Head title="1ST FLOOR // MARKET DATA INGESTION" sub="Raw tape in · clean candidate table out · 09:45 ET is the primary data event" img="/assets/floor1.jpg" />
    <Tabs tab={tab} setTab={setTab} tabs={[["uni", "Universe"], ["sched", "Schedule"], ["src", "Sources"]]} />
    <ErrorPanel errors={errors.filter(e => e.endpoint === "/api/scan")} lastOk={lastOk} />
    {tab === "uni" && <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="filter symbol…" style={{ maxWidth: 240 }} />
        <button className={"btn ghost"} onClick={() => setBand(b => !b)}>{band ? "ALL NAMES" : "IN-BAND ONLY"}</button>
        <span className="muted mono">{scan ? `${scan.rows.length} symbols · feed ${scan.feed} · as of ${new Date(scan.asOf).toLocaleTimeString()}` : state}</span>
      </div>
      <div className="panel tbl-wrap">
        {!scan ? <Loading what="scan" /> : <table>
          <thead><tr><th>SYM</th><th>LAST</th><th>GAP%</th><th>RVOL</th><th>SCORE</th><th>OR H</th><th>OR L</th><th>VWAP</th><th>SPRD%</th><th>GATE</th></tr></thead>
          <tbody>{list.map(r => {
            const el = E.rowEligible(r); const sp = E.spreadPct(r);
            return <tr key={r.symbol} className="click" onClick={() => { window.location.href = `/floor/3?sym=${r.symbol}`; }}>
              <td>{r.symbol}{r.dyn ? <> <Pill kind="mid">DYN</Pill></> : null}</td>
              <td>{fm(r.price)}</td><td>{fm(r.gap)}</td><td>{fm(r.rvol)}</td><td>{E.score(r).toFixed(2)}</td>
              <td>{fm(r.orh)}</td><td>{fm(r.orl)}</td><td>{fm(r.vwap)}</td><td>{sp == null ? "—" : sp.toFixed(3)}</td>
              <td>{el.pass ? <Pill kind="go">PASS</Pill> : <Pill kind="no" title={el.fails.join(" · ")}>{el.fails.length} FAIL</Pill>}</td>
            </tr>;
          })}</tbody>
        </table>}
      </div>
    </div>}
    {tab === "sched" && <div>
      <div className="grid g3">
        <Kpi label="09:00 ET" value="PRE-MARKET" /><Kpi label="09:45 ET" value="OR CAPTURE" tone="gold" /><Kpi label="16:15 ET" value="JOURNAL SYNC" />
      </div>
      <div className="panel"><p>At 09:45 the floor captures for every symbol: gap %, opening-range RVOL, OR high/low, last price, bid/ask spread. Spread &gt; 0.2% of price disqualifies. Inverse/volatility ETPs, OTC, warrants, and sub-$3 names never enter. Two crons run unattended: regime snapshot after the open, journal sync after the close.</p></div>
    </div>}
    {tab === "src" && <div className="panel tbl-wrap">
      <table><thead><tr><th>Source</th><th>What</th><th>How</th></tr></thead><tbody>
        <tr><td>/api/scan</td><td>Universe rows: last, gap, RVOL, OR, session VWAP, 5-min closes, NBBO spread</td><td>route handler → Alpaca data API (keys stay server-side)</td></tr>
        <tr><td>/api/account</td><td>Capped equity, weekly drawdown, cooling-off, trades today, clock</td><td>route handler → Alpaca trading API</td></tr>
        <tr><td>/api/journal</td><td>Round trips rebuilt from actual fills + bracket legs, breach codes derived</td><td>route handler → Alpaca closed orders (nested)</td></tr>
        <tr><td>/api/evidence</td><td>Journal + regime snapshots + gate-block days + five-tile stats</td><td>route handler → Alpaca + KV</td></tr>
        <tr><td>Alpaca screener</td><td>Most-active + top gainers added to the core universe</td><td>inside /api/scan, best-effort</td></tr>
      </tbody></table>
      <p className="muted">All endpoints are read-only proxies. There is no order route anywhere in this deployment, and none may be added.</p>
    </div>}
  </section>;
}

/* ---------------- FLOOR 2 · ANALYZE ---------------- */
export function Floor2() {
  const { scan, verdict, errors, lastOk } = useHud();
  const [tab, setTab] = useState("rank");
  const list = verdict?.ranked ?? [];
  const elig = list.filter(r => r.tier === 0).length, pend = list.filter(r => r.tier === 1).length;
  const v = verdict;
  return <section className="view">
    <Head title="2ND FLOOR // MULTI-VARIABLE ANALYSIS" sub="Trade the day, not the calendar. Only the top-1 in-play name advances." img="/assets/floor2.jpg" />
    <Tabs tab={tab} setTab={setTab} tabs={[["rank", "Rank"], ["gates", "Gates"], ["grave", "Graveyard"], ["reg", "Regime"]]} />
    <ErrorPanel errors={errors} lastOk={lastOk} />
    {tab === "rank" && <div>
      <div className="grid g3">
        <Kpi label="MIN SCORE" value={E.RULES.minScore.toFixed(2)} />
        <Kpi label="TOP NAME" value={v?.top ?? "—"} />
        <Kpi label="IN PLAY?" value={v ? (v.verdict === "TRADE_ARMED" ? "ARMED" : v.verdict === "STAGED" ? "STAGED" : "NO") : "—"} tone={v?.verdict === "TRADE_ARMED" ? "ok" : v?.verdict === "STAGED" ? "warn" : "bad"} />
      </div>
      <div className="panel tbl-wrap">
        {!scan ? <Loading what="ranking" /> : <table>
          <thead><tr><th>#</th><th>SYM</th><th>SCORE</th><th>RANK</th><th>GAP</th><th>RVOL</th><th>WIDTH%</th><th>SPRD%</th><th>ADVANCE</th></tr></thead>
          <tbody>{list.map((r, i) => {
            const el = E.rowEligible(r); const w = E.orWidthPct(r), sp = E.spreadPct(r);
            const capped = (r.rankScore ?? 0) < E.score(r) - 0.005;
            return <tr key={r.symbol} className="click" title={TIER_LBL[r.tier ?? 2] + (el.pass ? "" : " — " + el.fails.join(" · "))} onClick={() => { window.location.href = `/floor/3?sym=${r.symbol}`; }}>
              <td>{i + 1}</td><td>{r.symbol}</td><td>{E.score(r).toFixed(2)}</td>
              <td style={capped ? { color: "var(--dim)" } : undefined} title={capped ? "capped for ranking — raw score is a halted-news outlier, not a better setup" : ""}>{fm(r.rankScore)}{capped ? "*" : ""}</td>
              <td>{fm(r.gap)}</td><td>{fm(r.rvol)}</td><td>{w == null ? "—" : w.toFixed(2)}</td><td>{sp == null ? "—" : sp.toFixed(3)}</td>
              <td>{r.tier === 0 ? <Pill kind="go">{i === 0 ? "TOP-1" : "READY"}</Pill> : r.tier === 1 ? <Pill kind="mid" title={el.fails.join(" · ")}>PENDING</Pill> : <Pill kind="no" title={el.fails.join(" · ")}>VETO</Pill>}</td>
            </tr>;
          })}</tbody>
        </table>}
        <p className="ticket-card" style={{ margin: "10px 0 0" }}>Ranked by tier, then by capped score (RANK column; <b>*</b> = capped). <b style={{ color: "var(--ok)" }}>{elig} tradeable</b> · <b style={{ color: "var(--yellow)" }}>{pend} pending data</b> · <b style={{ color: "var(--bad)" }}>{list.length - elig - pend} disqualified</b>. Untradeable names cannot outrank a clean setup.</p>
      </div>
    </div>}
    {tab === "gates" && <div className="panel"><h3>GATES — TOP-1 {v?.top ?? "—"}</h3><GateList ticket={v?.ticket ?? null} /></div>}
    {tab === "grave" && <div className="panel tbl-wrap">
      <p>Learned from June–August 2026 (~40 configs, 5 bps/side). Do not revisit without new data.</p>
      <table><thead><tr><th>Setup</th><th>n</th><th>Win</th><th>Avg R</th><th>PF</th><th>Verdict</th></tr></thead><tbody>
        <tr><td>Everyday ORB, liquid names</td><td>90</td><td>39%</td><td>−0.13</td><td>0.70</td><td><Pill kind="no">DEAD</Pill></td></tr>
        <tr><td>VWAP pullback continuation</td><td>—</td><td>—</td><td>—</td><td>0.56</td><td><Pill kind="no">DEAD</Pill></td></tr>
        <tr><td>VWAP-stretch mean reversion</td><td>95–458</td><td>23–46%</td><td>−0.18 to −0.44</td><td>0.49–0.70</td><td><Pill kind="no">DEAD</Pill></td></tr>
        <tr><td>In-play TOP-1 ORB only (v4)</td><td>5</td><td>—</td><td>+0.45</td><td>4.59</td><td><Pill kind="mid">HYPOTHESIS</Pill></td></tr>
      </tbody></table>
    </div>}
    {tab === "reg" && <div>
      <div className="grid g2e">
        <Kpi label={`SPY ${fm(scan?.index?.SPY?.price)}`} value={scan?.index?.SPY?.gap != null ? (scan.index.SPY.gap >= 0 ? "+" : "") + scan.index.SPY.gap + "%" : "—"} />
        <Kpi label={`QQQ ${fm(scan?.index?.QQQ?.price)}`} value={scan?.index?.QQQ?.gap != null ? (scan.index.QQQ.gap >= 0 ? "+" : "") + scan.index.QQQ.gap + "%" : "—"} />
      </div>
      <div className="panel"><p>Daily GREEN / YELLOW / RED snapshots and the per-regime results live on <Link href="/evidence/regime">Evidence → Regime</Link>. Chop regimes demand extra selectivity. A high RVOL without a catalyst is often a trap.</p></div>
    </div>}
  </section>;
}

/* ---------------- FLOOR 3 · DECIDE ---------------- */
export function Floor3({ initialSym }: { initialSym?: string }) {
  const { scan, verdict, ctx, errors, lastOk, setStaged } = useHud();
  const [tab, setTab] = useState("ticket");
  const [sym, setSym] = useState(initialSym || "");
  const ranked = verdict?.ranked ?? [];
  const chosen = (sym || ranked[0]?.symbol || "").toUpperCase();
  const row: Row | undefined = ranked.find(r => r.symbol === chosen);
  const ticket: Ticket | null = useMemo(() => {
    if (!scan || !row) return null;
    return E.buildTicket(row, { ...ctx(), topSymbol: ranked[0]?.symbol ?? null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan, row, verdict]);
  React.useEffect(() => { setStaged(ticket); }, [ticket, setStaged]);
  const eq = ctx().equity as number;
  return <section className="view">
    <Head title="3RD FLOOR // INTELLIGENT DECISION" sub="ORB15-long, $750 doctrine, one trade per day. The live feed is the truth — nothing on this floor is typed." img="/assets/floor3.jpg" />
    <Tabs tab={tab} setTab={setTab} tabs={[["ticket", "Ticket"], ["sizer", "Sizer"], ["laws", "Laws"], ["ladder", "Ladder"]]} />
    <ErrorPanel errors={errors} lastOk={lastOk} />
    {tab === "ticket" && <div className="grid g2">
      <div className="panel hot">
        <div className="grid g2e">
          <div><label>SYMBOL</label><select value={chosen} onChange={e => setSym(e.target.value)}>{ranked.map(r => <option key={r.symbol} value={r.symbol}>{r.symbol} · {TIER_LBL[r.tier ?? 2]}</option>)}</select></div>
          <div><label>EQUITY $ (capped, from account)</label><input readOnly value={scan ? fm(eq, 0) : "—"} /></div>
          <div><label>OR HIGH</label><input readOnly value={fm(row?.orh)} /></div>
          <div><label>OR LOW</label><input readOnly value={fm(row?.orl)} /></div>
          <div><label>GAP %</label><input readOnly value={fm(row?.gap)} /></div>
          <div><label>OR RVOL</label><input readOnly value={fm(row?.rvol)} /></div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn ghost" onClick={() => setSym(ranked[0]?.symbol ?? "")}>LOAD TOP NAME</button>
          <button className="btn gold" disabled={!ticket} onClick={() => {
            if (!ticket) return;
            const blob = new Blob([JSON.stringify(ticket, null, 2)], { type: "application/json" });
            const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
            a.download = `ticket_${scan?.etDate ?? new Date().toISOString().slice(0, 10)}.json`; a.click();
          }}>EXPORT JSON</button>
        </div>
        <div className="code" style={{ marginTop: 12 }}>{ticket ? JSON.stringify(ticket, null, 2) : scan ? "Pick a symbol." : "Awaiting live data…"}</div>
      </div>
      <div className="panel"><h3>GATES — EVERY ONE ENFORCED</h3><GateList ticket={ticket} /><div style={{ marginTop: 10 }}><VerdictBanner ticket={ticket} /></div></div>
    </div>}
    {tab === "sizer" && <div className="panel">
      <p>Shares = min(floor(2% equity ÷ stop-distance), floor(equity ÷ entry)), whole shares. Skip if stop &gt; 3% of price. Target = entry + 1.5R. Long only — cash account, no locates.</p>
      <div className="grid g4">
        <Kpi label="ENTRY" value={fm(ticket?.entry_est)} /><Kpi label="STOP" value={fm(ticket?.stop)} tone="bad" />
        <Kpi label="TARGET 1.5R" value={fm(ticket?.target)} tone="ok" /><Kpi label="SHARES" value={ticket?.shares ?? "—"} tone="gold" />
      </div>
    </div>}
    {tab === "laws" && <div className="panel"><ul>
      <li>Trigger: 5-min close above OR high AND above session VWAP. No touch entries.</li>
      <li>Stop is OR low — structural, never moved down.</li>
      <li>Time stop 15:55 ET. No overnight. TIF day on the bracket.</li>
      <li>PDT: one round-trip per day by design. Fits cash (T+1) or margin (3/5).</li>
      <li>Losing day → next day observation-only. Equity &lt; $500 → halt.</li>
      <li>Weekly drawdown &gt; 6% → stand down until Monday.</li>
    </ul></div>}
    {tab === "ladder" && <div className="panel tbl-wrap">
      <table><thead><tr><th>Equity</th><th>Risk/trade</th><th>Note</th></tr></thead><tbody>
        <tr><td>$750</td><td>$15 (2%)</td><td>Validation — the goal is not-losing while proving edge</td></tr>
        <tr><td>$1,500</td><td>$25</td><td>Only after 40+ trades with PF ≥ 1.3 and the go-live gate met</td></tr>
        <tr><td>$5,000</td><td>$75</td><td></td></tr>
        <tr><td>$25,000</td><td>—</td><td>PDT-free; menu can widen</td></tr>
      </tbody></table>
      <p>At +0.2R expectancy, $15 risk ≈ +$3/trade. Anyone promising five figures from $750 in weeks is describing gambling.</p>
    </div>}
  </section>;
}

/* ---------------- FLOOR 4 · EXECUTE ---------------- */
export function Floor4() {
  const { verdict, staged, scan, account, errors, lastOk } = useHud();
  const [tab, setTab] = useState("prev");
  const [dry, setDry] = useState<string>("");
  const t = staged || verdict?.ticket || null;
  const preview = !t ? "No ticket. Build one on Floor 3."
    : t.armed ? `=== ORDER PREVIEW · ARMED ===\n  ${t.symbol}  BUY ${t.shares} sh  limit ${t.entry_est}\n  bracket: stop ${t.stop}  |  take-profit ${t.target}  |  TIF day\n  $ at risk: ${t.dollars_at_risk}  position: ${t.position_value}\n\nDRY RUN — HUD submits nothing. You run executor.py --approve.`
    : t.ok ? `=== STAGED · NOT ARMED ===\n  ${t.symbol}  ${t.shares} sh  limit ${t.entry_est} / stop ${t.stop} / tgt ${t.target}\n  waiting on trigger: 5-min close > ${fm(t.or_high)} AND > VWAP ${fm(t.vwap)}\n  (last 5m close: ${fm(t.last_close_5m)})`
    : `VERDICT: NO TRADE\n${t.reasons.join("\n")}`;
  const date = scan?.etDate ?? new Date().toISOString().slice(0, 10);
  return <section className="view">
    <Head title="4TH FLOOR // PRECISE EXECUTION" sub="Human approval is the door. This HUD never submits an order." img="/assets/floor4.jpg" />
    <div className="warn-banner">HARD GATE — scanner writes tickets. executor.py dry-runs. --approve submits PAPER. Live needs --live AND GLADIATOR_LIVE_CONFIRM=YES, run by you. No order route exists in this deployment.</div>
    <Tabs tab={tab} setTab={setTab} tabs={[["prev", "Preview"], ["life", "Lifecycle"], ["status", "Account"], ["safe", "Safety"]]} />
    <ErrorPanel errors={errors} lastOk={lastOk} />
    {tab === "prev" && <div className="panel gold">
      <div className="code">{preview}</div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => setDry(!t ? "No ticket." : t.armed ? "DRY RUN COMPLETE — would submit PAPER bracket on " + t.symbol + ". Run executor.py with --approve to actually send. The HUD will not." : t.ok ? "HELD — structurally valid but the trigger gate is not confirmed (5m close > OR-H & VWAP). The HUD refuses to arm early." : "BLOCKED — " + t.reasons.join("; "))}>SIMULATE DRY RUN</button>
        <button className="btn ghost" onClick={() => navigator.clipboard.writeText(`python bot/executor.py --ticket bot/tickets/ticket_${date}.json`)}>COPY EXECUTOR COMMAND</button>
        <Link className="btn ghost" href="/evidence/trades">OPEN JOURNAL</Link>
      </div>
      {dry ? <div className="ticket-card" style={{ marginTop: 10 }}>{dry}</div> : null}
    </div>}
    {tab === "life" && <div className="panel tbl-wrap"><table><thead><tr><th>Time</th><th>Action</th></tr></thead><tbody>
      <tr><td>Trigger confirmed</td><td>Submit bracket (limit + stop + 1.5R target, TIF day)</td></tr>
      <tr><td>+15 min unfilled</td><td>Cancel — do not chase</td></tr>
      <tr><td>Filled</td><td>Brackets manage. No intervention except EOD.</td></tr>
      <tr><td>15:55 ET</td><td>If still open, market-close</td></tr>
      <tr><td>16:15 ET</td><td>Journal sync runs; breaches derived from fills</td></tr>
    </tbody></table></div>}
    {tab === "status" && <div className="grid g4">
      <Kpi label="ACCOUNT" value={account?.account_number ?? "—"} sub={account ? (account.paper ? "PAPER" : "LIVE KEYS") : ""} tone={account && !account.paper ? "bad" : "ok"} />
      <Kpi label="EQUITY (CAPPED)" value={account ? "$" + fm(account.equity, 0) : "—"} sub={account ? `real $${fm(account.real_equity, 0)}` : ""} tone="gold" />
      <Kpi label="WEEKLY DD" value={account ? account.weeklyDDPct.toFixed(1) + "%" : "—"} sub={account ? `$${fm(account.weeklyDDDollars)} given back` : ""} tone={account && account.weeklyDDPct > E.RULES.maxWeeklyDDPct ? "bad" : ""} />
      <Kpi label="COOLING-OFF" value={account ? (account.coolingOff ? "ON" : "CLEAR") : "—"} sub={account?.coolingDetail} tone={account?.coolingOff ? "warn" : "ok"} />
      <Kpi label="TRADES TODAY" value={account ? `${account.tradedToday} / 1` : "—"} />
      <Kpi label="PREV SESSION" value={account?.prevDayR != null ? `${account.prevDayR >= 0 ? "+" : ""}${account.prevDayR}R` : "—"} sub={account?.prevTradingDay ?? ""} />
      <Kpi label="MARKET" value={account ? (account.clock.is_open ? "OPEN" : "CLOSED") : "—"} sub={account ? `next ${account.clock.is_open ? "close " + new Date(account.clock.next_close).toLocaleTimeString() : "open " + new Date(account.clock.next_open).toLocaleString()}` : ""} />
      <Kpi label="CASH" value={account?.cash != null ? "$" + fm(account.cash, 0) : "—"} />
    </div>}
    {tab === "safe" && <div className="panel"><ul>
      <li>This HUD cannot place orders. The /api endpoints are read-only proxies — no order route exists in this deployment. The bot never decides to go live — only you do.</li>
      <li>Paper proving ground; live keys stay in env, never in files.</li>
      <li>Breaches are derived from fills automatically: NO_STOP, MANUAL_EXIT, SECOND_TRADE, OUTSIDE_WINDOW, OVERSIZED, HELD_OVERNIGHT. One inside the last 20 blocks go-live.</li>
      <li>Kill switch: a file named STOP in the project root. Never delete it if present.</li>
    </ul></div>}
  </section>;
}
