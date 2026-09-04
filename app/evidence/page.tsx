"use client";
import { EvidenceError, EvidenceHeader, Scoreboard, EquityCurve, useEvidence, Pending } from "@/components/evidence";
export default function Page() {
  const { data } = useEvidence();
  return <section className="view">
    <EvidenceHeader title="EVIDENCE // GO-LIVE GATE" sub="Five thresholds, broker fills only, breaches derived from fills. n=5 is an anecdote. n=40 is validation." />
    <EvidenceError />
    {data ? <><Scoreboard stats={data.stats} /><div className="panel" style={{ marginTop: 12 }}><EquityCurve stats={data.stats} entries={data.entries} snapshots={data.regime.snapshots} /></div></> : <Pending what="evidence" />}
  </section>;
}
