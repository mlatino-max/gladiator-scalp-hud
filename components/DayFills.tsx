"use client";
import React from "react";
import { useEvidence, TradeRow, BreachPills } from "./evidence";
import { Kpi, Pill } from "./ui";
import { fm } from "@/lib/engine-client";

export default function DayFills({ date }: { date: string }) {
  const { data, error } = useEvidence();
  if (error) return <div className="err-banner"><b>EVIDENCE</b>{error}</div>;
  if (!data) return <div className="muted mono">loading fills…</div>;
  const recs = data.entries.filter(e => e.date === date || e.exitDate === date);
  const regime = data.regime.snapshots[date];
  const vd = data.verdictDays.find(v => v.date === date);
  return <div>
    <div className="grid g2e">
      <Kpi label="REGIME" value={<Pill kind={regime?.regime ?? "UNKNOWN"}>{regime?.regime ?? "UNKNOWN"}</Pill>} sub={regime ? `SPY ${fm(regime.spyClose)} · SMA20 ${fm(regime.sma20)} · SMA50 ${fm(regime.sma50)} · ${regime.source}` : "no snapshot for this date"} />
      <Kpi label="VERDICT (last in window)" value={vd?.verdict ?? "—"} sub={vd ? `${vd.top ?? "—"}${vd.firstBlock ? " · blocked by " + vd.firstBlock : ""}` : "no verdict snapshot"} />
    </div>
    <div className="panel">
      <h3>ROUND TRIPS</h3>
      {recs.length === 0 ? <p className="muted">no fills on {date} — an empty day is honest</p> : recs.map(r => <div key={r.id} style={{ marginBottom: 12 }}>
        <TradeRow r={r} />
        <div className="ticket-card"><BreachPills codes={r.breaches} /></div>
      </div>)}
    </div>
  </div>;
}
