"use client";
import React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useHud } from "./HudProvider";
import { usePhase } from "./Shell";
import { E, fm } from "@/lib/engine-client";
import { ErrorPanel, Kpi } from "./ui";
import { useEvidence } from "./evidence";

const NeuralCore = dynamic(() => import("./NeuralCore"), { ssr: false, loading: () => <div style={{ height: 420 }} className="muted mono">loading core…</div> });

export default function Deck() {
  const { state, scan, account, verdict, errors, lastOk } = useHud();
  const { data: ev } = useEvidence();
  const { phase, countdown } = usePhase();
  const eq = account?.equity ?? null;
  const v = verdict;
  const etDate = scan?.etDate ?? "—";
  return <section className="view">
    <div className="hero">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/neural-core-4lobe.jpg" alt="" />
      <div className="cap"><h3>NEURAL CORE ONLINE</h3><p>Four lobes, four floors, one evidence gate. Cyan ingest · blue analyze · orange decide · yellow execute · green evidence. Selectivity is the edge.</p></div>
    </div>
    <ErrorPanel errors={errors} lastOk={lastOk} />
    <div className="grid g2">
      <div className="panel core3d">
        <div className="view-head"><h2>NEURAL CORE</h2><p>Drag to orbit · click a lobe to enter that floor</p></div>
        <div className="brain-wrap">
          <NeuralCore />
          <div className="brain-tags">
            <Link className="t1" href="/floor/1">F1 · INGEST</Link><Link className="t2" href="/floor/2">F2 · ANALYZE</Link>
            <Link className="t3" href="/floor/3">F3 · DECIDE</Link><Link className="t4" href="/floor/4">F4 · EXECUTE</Link>
          </div>
        </div>
      </div>
      <div>
        <div className="grid g2e">
          <Kpi label="TODAY" value={v ? v.verdict.replace("_", " ") : state} tone={v?.verdict === "TRADE_ARMED" ? "ok" : v?.verdict === "STAGED" ? "warn" : v ? "bad" : ""} />
          <Kpi label="EQUITY" value={eq == null ? "—" : "$" + fm(eq, 0)} tone="gold" />
          <Kpi label="1R RISK" value={eq == null ? "—" : "$" + (eq * E.RULES.riskPct).toFixed(2)} />
          <Kpi label="N=40 GATE" value={ev ? `${ev.stats.n}/40` : "—"} sub={ev ? ev.stats.tier.tier : undefined} tone={ev?.stats.goLive ? "ok" : ""} />
        </div>
        <div className="panel hot" style={{ marginTop: 12 }}>
          <h3>LIVE DESK STATUS</h3>
          <div className="ticket-card">
            <b>{etDate}</b> · data <b style={{ color: state === "LIVE" ? "var(--ok)" : state === "STALE" ? "var(--orange)" : "var(--bad)" }}>{state}</b><br />
            {v ? <>verdict: <b style={{ color: "var(--orange)" }}>{v.verdict}</b> — {v.reason}<br /></> : <>verdict: <b>—</b> (no live data, nothing is shown)<br /></>}
            {account ? <>equity ${account.equity.toFixed(2)}{account.real_equity > account.equity ? <span className="muted"> (working capital — account holds ${account.real_equity.toFixed(0)}, capped by doctrine)</span> : null} · weekly DD {account.weeklyDDPct.toFixed(1)}% · {account.coolingDetail} · trades today {account.tradedToday}/1</> : <>account: —</>}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <Link className="btn" href="/floor/1">OPEN FLOOR 1</Link>
            <Link className="btn orange" href="/floor/3">BUILD TICKET</Link>
            <Link className="btn ghost" href="/evidence">EVIDENCE</Link>
          </div>
        </div>
        <div className="panel gold">
          <h3>NEXT EVENT</h3>
          <Kpi label={phase.next} value={countdown} tone="gold" />
        </div>
      </div>
    </div>
  </section>;
}
