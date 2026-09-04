"use client";
import { EvidenceError, EvidenceHeader, TradesTable, useEvidence, Pending } from "@/components/evidence";
export default function Page() {
  const { data } = useEvidence();
  return <section className="view">
    <EvidenceHeader title="EVIDENCE // TRADES" sub="Every round trip reconstructed from fills. Excluded rows stay visible, greyed, with the reason. Click a row for fills, the FIFO match and the hand-check formula." />
    <EvidenceError />
    {data ? <TradesTable data={data} /> : <Pending what="trades" />}
  </section>;
}
