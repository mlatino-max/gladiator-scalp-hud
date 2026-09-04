"use client";
import React from "react";
import { fm } from "@/lib/engine-client";
import type { Gate, Ticket } from "@/lib/types";
import type { HudError } from "./HudProvider";

export function Kpi({ label, value, sub, tone, title }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "ok" | "warn" | "bad" | "gold" | "noise" | ""; title?: string }) {
  return <div className={"kpi " + (tone || "")} title={title}><div className="l">{label}</div><div className="v">{value}</div>{sub ? <div className="s">{sub}</div> : null}</div>;
}
export function Pill({ kind, children, title }: { kind: string; children: React.ReactNode; title?: string }) {
  return <span className={"pill " + kind} title={title}>{children}</span>;
}
export function GateList({ ticket }: { ticket: Ticket | null }) {
  if (!ticket) return <div className="muted">no ticket</div>;
  return <div>{ticket.gates.map((g: Gate) => (
    <div className="gate" key={g.key}>
      <span>{g.label}{g.blocking ? "" : <small className="muted"> (arm)</small>}</span>
      <span className="st" style={{ color: g.pass ? "var(--ok)" : "var(--bad)" }}>{g.pass ? "✓ PASS" : "✗ FAIL"} <small>{g.detail}</small></span>
    </div>
  ))}</div>;
}
export function VerdictBanner({ ticket }: { ticket: Ticket | null }) {
  if (!ticket) return null;
  if (ticket.armed) return <div className="ok-banner">TICKET ARMED — all gates + trigger pass. Still requires human --approve on Floor 4.</div>;
  if (ticket.ok) return <div className="warn-banner">STAGED — structural gates pass. Waiting on trigger: 5m close &gt; OR-H &amp; VWAP.</div>;
  return <div className="warn-banner">NO TRADE · {ticket.reasons.join(" · ")}</div>;
}
/* The explicit error state. Never paints a number from fallback data. */
export function ErrorPanel({ errors, lastOk, title }: { errors: HudError[]; lastOk: string | null; title?: string }) {
  if (!errors.length) return null;
  return <div className="err-banner" role="alert">
    <b>{title || "DATA ERROR — no numbers shown from this source"}</b>
    {errors.map((e, i) => <div key={i}>{e.endpoint} → {e.status ?? "network"}: {e.message}{e.hint ? <div className="muted">hint: {e.hint}</div> : null}</div>)}
    <div className="muted">last good fetch: {lastOk ? new Date(lastOk).toLocaleTimeString() : "never this session"}</div>
    {errors.some(e => e.status === 401) ? <div className="muted">401 → set the HUD token on the Ops page (stored as an httpOnly cookie). If keys were just rotated, the live container may still hold old keys.</div> : null}
    {errors.some(e => e.status === 502 || e.status === 503 || e.status === null) ? <div className="muted">Upstream unreachable. If the broker gateway was cold, it wakes in about a minute; this page retries on its own.</div> : null}
  </div>;
}
export function TicketCard({ t }: { t: Ticket | null }) {
  if (!t || t.symbol === "—") return <div className="ticket-card">No ticket staged.</div>;
  return <div className="ticket-card">
    <b>{t.symbol}</b> {t.setup}<br />score {fm(t.score)}<br />
    entry {fm(t.entry_est)} · stop {fm(t.stop)} · tgt {fm(t.target)}<br />
    sh {t.shares} · risk ${fm(t.dollars_at_risk)}<br />
    {t.armed ? <Pill kind="go">ARMED</Pill> : t.ok ? <Pill kind="mid">STAGED</Pill> : <Pill kind="no">NO TRADE</Pill>}
  </div>;
}
export function Loading({ what }: { what?: string }) {
  return <div className="muted mono">loading {what || "data"}…</div>;
}
