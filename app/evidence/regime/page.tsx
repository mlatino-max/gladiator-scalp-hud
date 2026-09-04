"use client";
import { EvidenceError, EvidenceHeader, RegimeView, useEvidence, Pending } from "@/components/evidence";
export default function Page() {
  const { data } = useEvidence();
  return <section className="view">
    <EvidenceHeader title="EVIDENCE // REGIME & BLOCKS" sub="Results split by the regime snapshotted each morning, and which gate blocked on no-trade days." />
    <EvidenceError />
    {data ? <RegimeView data={data} /> : <Pending what="regime" />}
  </section>;
}
