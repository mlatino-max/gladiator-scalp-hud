"use client";
import React, { useState } from "react";
import Link from "next/link";
import { Kpi } from "./ui";
import { useEvidence, EquityCurve } from "./evidence";
import { fpf } from "@/lib/engine-client";

const SWEEPS = [
  { label: "ORB no-filter fix15", n: 90, win: 0.39, avg: -0.132, pf: 0.70 },
  { label: "ORB PDH fix15", n: 23, win: 0.39, avg: -0.151, pf: 0.56 },
  { label: "ORB gap fix15", n: 37, win: 0.32, avg: -0.172, pf: 0.56 },
  { label: "ORB trail", n: 90, win: 0.32, avg: -0.153, pf: 0.51 },
  { label: "VWAP K1.5 s1.5", n: 458, win: 0.46, avg: -0.177, pf: 0.68 },
  { label: "VWAP K2.0 s1.5", n: 411, win: 0.42, avg: -0.182, pf: 0.70 },
  { label: "VWAP K2.5 s1.0", n: 360, win: 0.23, avg: -0.439, pf: 0.49 },
  { label: "IN-PLAY TOP1 ORB", n: 5, win: null as number | null, avg: 0.45, pf: 4.59 }
];

export default function Lab() {
  const [tab, setTab] = useState("edge");
  const { data } = useEvidence();
  const st = data?.stats ?? null;
  const W = 900, H = 260, max = 5;
  return <section className="view">
    <div className="view-head"><div><h2>ANALYSIS LAB</h2><p>Backtest evidence from SCALPER-OPS research · June 2 – Aug 26 2026 sample. Live evidence lives on the <Link href="/evidence">Evidence</Link> floor.</p></div></div>
    <div className="tabs">{[["edge", "Edge"], ["sweep", "Sweeps"], ["eq", "Live Equity"], ["n40", "n=40 Gate"]].map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === "edge" && <div>
      <div className="grid g4">
        <Kpi label="FIXED-UNIVERSE ORB PF" value="0.70" tone="bad" /><Kpi label="VWAP PB PF" value="0.56" tone="bad" />
        <Kpi label="VWAP REV PF" value="0.49–0.70" tone="bad" /><Kpi label="IN-PLAY TOP1 PF" value="4.59*" tone="ok" />
      </div>
      <div className="panel"><p>* n=5 backtest. Directional, not proof. Validation requires ≥ 40 paper trades, PF ≥ 1.3, avg ≥ +0.15R, max DD &lt; 10%, zero protocol breaches in the final 20 — all from broker fills.</p></div>
    </div>}
    {tab === "sweep" && <div>
      <div className="panel">
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="profit factor per sweep config">
          {SWEEPS.map((s, i) => {
            const x = 20 + i * ((W - 40) / SWEEPS.length); const bh = Math.min(H - 40, Math.abs(s.pf) / max * (H - 50));
            const c = s.pf >= 1.3 ? "#39ff9a" : s.pf >= 1 ? "#ffe14a" : "#ff6a00";
            return <g key={s.label}><rect x={x} y={H - 30 - bh} width={40} height={bh} fill={c} opacity={0.85} /><text x={x} y={H - 14}>{s.pf.toFixed(2)}</text></g>;
          })}
          <line x1={20} x2={W - 20} y1={H - 30 - 1.3 / max * (H - 50)} y2={H - 30 - 1.3 / max * (H - 50)} stroke="#39ff9a" strokeDasharray="4 4" />
        </svg>
      </div>
      <div className="panel tbl-wrap"><table><thead><tr><th>CONFIG</th><th>n</th><th>WIN</th><th>AVG R</th><th>PF</th></tr></thead><tbody>
        {SWEEPS.map(s => <tr key={s.label}><td>{s.label}</td><td>{s.n}</td><td>{s.win == null ? "—" : (s.win * 100).toFixed(0) + "%"}</td><td>{s.avg}</td><td>{s.pf}</td></tr>)}
      </tbody></table></div>
    </div>}
    {tab === "eq" && <div className="panel">{data ? <EquityCurve stats={data.stats} entries={data.entries} snapshots={data.regime.snapshots} /> : <div className="muted mono">loading evidence…</div>}</div>}
    {tab === "n40" && <div className="panel">
      <div className="grid g2e">
        <Kpi label="PAPER TRADES LOGGED" value={st ? `${st.n} / 40` : "—"} />
        <Kpi label="EVIDENCE TIER" value={st?.tier.label ?? "—"} tone="gold" />
      </div>
      <div className="bar" style={{ margin: "12px 0" }}><i style={{ width: `${Math.max(2, Math.min(100, (st?.n ?? 0) / 40 * 100))}%` }} /></div>
      {st ? <div className="ticket-card">PF {fpf(st.pf)} · avg {st.avgR.toFixed(3)}R · win {(st.winRate * 100).toFixed(0)}% · maxDD {st.maxDDPct.toFixed(1)}% · breaches in last 20: {st.breachesLast20}<br />
        Counted: broker fills only. {st.excluded.total ? <b style={{ color: "var(--orange)" }}>{st.excluded.total} excluded</b> : null}<br />{st.tier.note}<br />
        <b style={{ color: st.goLive ? "var(--ok)" : "var(--orange)" }}>{st.verdict}</b></div> : null}
      <p className="ticket-card" style={{ marginTop: 10 }}>n=5 is an anecdote. n=40 is validation. 100+ across different market regimes starts becoming evidence. Nothing below that earns size.</p>
    </div>}
  </section>;
}
