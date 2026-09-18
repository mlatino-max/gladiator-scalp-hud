"use client";
import React, { useCallback, useEffect, useState } from "react";
import { Kpi } from "./ui";

type Meta = { available: boolean; renderedAt: string | null; bytes: number; lastRun: { ok: boolean; at: string; message: string } | null };

const ago = (iso: string | null) => {
  if (!iso) return "—";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export default function Hermes() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/hermes?meta=1", { cache: "no-store", credentials: "same-origin" });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
      setMeta(body); setErr(null);
    } catch (e) { setErr(String((e as Error).message || e)); }
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 5 * 60 * 1000); return () => clearInterval(t); }, [load]);

  const stale = meta?.renderedAt ? Date.now() - new Date(meta.renderedAt).getTime() > 26 * 3600 * 1000 : false;
  return <section className="view">
    <div className="view-head"><div><h2>HERMES PAPER DESK</h2>
      <p>The rsi2 and trend paper sleeves, drawn from the cloud sleeves&apos; own record by the <span className="mono">hermes</span> sidecar on this host. DRY-RUN, nothing placed. It renders whether or not the PC is on.</p></div></div>
    {err ? <div className="err-banner" role="alert"><b>/api/hermes</b>{err}</div> : null}
    <div className="grid g2e">
      <Kpi label="DESK" value={meta ? (meta.available ? "RENDERED" : "NONE YET") : "…"} sub={meta?.available ? ago(meta.renderedAt) : "waiting for the first render"} tone={meta ? (meta.available ? (stale ? "warn" : "ok") : "warn") : ""} />
      <Kpi label="LAST RUN" value={meta?.lastRun ? (meta.lastRun.ok ? "OK" : "FAILED") : "—"} sub={meta?.lastRun ? ago(meta.lastRun.at) : "no run recorded"} tone={meta?.lastRun ? (meta.lastRun.ok ? "ok" : "bad") : ""} />
    </div>
    {meta?.lastRun && !meta.lastRun.ok ? <div className="warn-banner" style={{ marginBottom: 10 }}>{meta.lastRun.message}{meta.available ? " — showing the last good render." : ""}</div> : null}
    {meta?.available ? <div className="panel">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/hermes?t=${encodeURIComponent(meta.renderedAt || "")}`} alt="HERMES paper desk: operation clock, paper equity, RSI(2) and distance to the 20-day high for SPY and QQQ" style={{ width: "100%", height: "auto", display: "block", borderRadius: 6 }} />
      {meta.lastRun?.ok ? <p className="muted mono" style={{ fontSize: 12, marginBottom: 0 }}>archive: {meta.lastRun.message}</p> : null}
    </div> : null}
  </section>;
}
