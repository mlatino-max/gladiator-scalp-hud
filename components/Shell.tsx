"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useHud } from "./HudProvider";
import { E, fm } from "@/lib/engine-client";
import { GateList, Kpi, TicketCard } from "./ui";

/* ---- routes, shortcuts and palette entries (spec §4) ---- */
export const ROUTES: { href: string; key: string; k: string; n: string; img?: string; cls?: string; group: "STRUCTURE" | "EVIDENCE" | "OPS" }[] = [
  { href: "/", key: "0", k: "00", n: "Command Deck", group: "STRUCTURE" },
  { href: "/floor/1", key: "1", k: "01 · INGEST", n: "Market Data", img: "/assets/floor1.jpg", group: "STRUCTURE" },
  { href: "/floor/2", key: "2", k: "02 · ANALYZE", n: "Multi-Variable", img: "/assets/floor2.jpg", group: "STRUCTURE" },
  { href: "/floor/3", key: "3", k: "03 · DECIDE", n: "Intelligent Ticket", img: "/assets/floor3.jpg", cls: "f3", group: "STRUCTURE" },
  { href: "/floor/4", key: "4", k: "04 · EXECUTE", n: "Precise Execution", img: "/assets/floor4.jpg", cls: "f4", group: "STRUCTURE" },
  { href: "/evidence", key: "e", k: "GATE", n: "Evidence", cls: "ev", group: "EVIDENCE" },
  { href: "/evidence/trades", key: "j", k: "JOURNAL", n: "Trades", cls: "ev", group: "EVIDENCE" },
  { href: "/evidence/regime", key: "r", k: "REGIME", n: "Regime & Blocks", cls: "ev", group: "EVIDENCE" },
  { href: "/lab", key: "a", k: "LAB", n: "Analysis Lab", group: "OPS" },
  { href: "/playbook", key: "p", k: "DOCTRINE", n: "Playbook", group: "OPS" },
  { href: "/ops", key: "o", k: "PIPE", n: "Ops Console", group: "OPS" }
];

function nyNow() { return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })); }
function phaseOf(d: Date) {
  const t = d.getHours() * 60 + d.getMinutes();
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return { name: "WEEKEND", next: "Mon 09:00 ET", target: null as number | null };
  if (t < 540) return { name: "PRE-SWEEP WAIT", next: "09:00 pre-market", target: 540 };
  if (t < 585) return { name: "PRE-MARKET SWEEP", next: "09:45 OR capture", target: 585 };
  if (t < 960) return { name: "SESSION LIVE", next: "15:55 time stop", target: 960 };
  if (t < 970) return { name: "FLAT / TIME STOP", next: "16:10 journal", target: 970 };
  return { name: "CLOSED / ARCHIVE", next: "next 09:00", target: null };
}
export function usePhase() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(nyNow()); const id = setInterval(() => setNow(nyNow()), 1000); return () => clearInterval(id); }, []);
  if (!now) return { time: "--:--:--", phase: { name: "BOOT", next: "—", target: null as number | null }, countdown: "--" };
  const ph = phaseOf(now);
  let countdown = "—";
  if (ph.target != null) {
    const left = ph.target - (now.getHours() * 60 + now.getMinutes());
    countdown = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
  }
  return { time: now.toTimeString().slice(0, 8), phase: ph, countdown };
}

export function DataChip() {
  const { state, lastOk, ageSec, refreshing, refresh } = useHud();
  const cls = state === "LIVE" ? "ok" : state === "STALE" ? "warn" : state === "ERROR" ? "bad" : "dim";
  const text = state === "LIVE" ? `DATA · LIVE ${lastOk ? new Date(lastOk).toLocaleTimeString() : ""}`
    : state === "STALE" ? `DATA · STALE ${ageSec >= 0 ? Math.round(ageSec / 60) + "m" : ""}`
    : state === "ERROR" ? "DATA · ERROR" : "DATA · LOADING";
  return <button className={"chip " + cls} onClick={() => void refresh()} title="click to refresh" style={{ cursor: "pointer" }}>
    {refreshing ? "⟳ " : ""}{text}
  </button>;
}

export function Header({ onMenu }: { onMenu: () => void }) {
  const { account, verdict, scan, strategy, strategies, setStrategy } = useHud();
  const { time, phase } = usePhase();
  const vcls = verdict ? (verdict.verdict === "TRADE_ARMED" ? "ok" : verdict.verdict === "STAGED" ? "warn" : "bad") : "dim";
  return <header className="top">
    <button className="icon-btn menu-btn" onClick={onMenu} title="Menu">☰</button>
    <Link href="/" className="brand" style={{ color: "inherit" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/neural-core.jpg" alt="" />
      <div><h1>GLADIATOR SCALP</h1><small>FOUR FLOORS + EVIDENCE // PAPER FIRST</small></div>
    </Link>
    <select className="strategy" value={strategy} onChange={e => setStrategy(e.target.value)} title="strategy">
      {strategies.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
    </select>
    <span className={"chip " + (phase.name.includes("LIVE") ? "ok" : phase.name.includes("STOP") ? "warn" : "")}><b>PHASE</b> {phase.name}</span>
    <DataChip />
    <span className={"chip " + (account ? (account.paper ? "ok" : "bad") : "warn")}>
      {account ? (account.paper ? "PAPER · " : "⚠ LIVE KEYS · ") + account.account_number : "ACCOUNT · —"}
    </span>
    <span className={"chip " + vcls} title={verdict?.reason || ""}>
      {verdict ? `${scan?.etDate ?? ""} · ${verdict.verdict} · ${verdict.top ?? "—"} ${verdict.score ?? ""}` : "SCAN · —"}
    </span>
    <PaletteButton />
    <div className="clock-block"><div className="t">{time} ET</div><div className="s">AMERICA/NEW_YORK · {phase.next}</div></div>
  </header>;
}

export function Nav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const path = usePathname();
  const on = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const group = (g: string) => ROUTES.filter(r => r.group === g).map(r => (
    <Link key={r.href} href={r.href} className={"nav-btn " + (r.cls || "") + (on(r.href) ? " on" : "")} onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {r.img ? <img src={r.img} alt="" /> : null}
      <span><span className="k">{r.k}</span><span className="n">{r.n}</span></span>
    </Link>
  ));
  return <nav className={"rail" + (open ? " open" : "")}>
    <h2>STRUCTURE</h2>
    <div className="lobe-map" title="Click a neural-core lobe">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/neural-core-4lobe.jpg" alt="neural core four lobes" />
      <Link className="hot f2" href="/floor/2" title="F2 Analyze" />
      <Link className="hot f1" href="/floor/1" title="F1 Ingest" />
      <Link className="hot f3" href="/floor/3" title="F3 Decide" />
      <Link className="hot f4" href="/floor/4" title="F4 Execute" />
    </div>
    {group("STRUCTURE")}
    <h2>EVIDENCE</h2>
    {group("EVIDENCE")}
    <h2>OPS</h2>
    {group("OPS")}
  </nav>;
}

export function Side() {
  const { account, verdict, staged } = useHud();
  const eq = account?.equity ?? null;
  const t = staged || verdict?.ticket || null;
  return <aside className="side">
    <h3>ACTIVE TICKET</h3>
    <TicketCard t={t} />
    <h3 style={{ marginTop: 18 }}>GATE TREE</h3>
    <GateList ticket={t} />
    <h3 style={{ marginTop: 18 }}>ACCOUNT</h3>
    <Kpi label="RISK CAP 2%" value={eq == null ? "—" : "$" + (eq * E.RULES.riskPct).toFixed(2)} />
    <div style={{ height: 8 }} />
    <Kpi label="WEEKLY DD" value={account ? account.weeklyDDPct.toFixed(1) + "%" : "—"} tone={account && account.weeklyDDPct > E.RULES.maxWeeklyDDPct ? "bad" : ""} />
    <div style={{ height: 8 }} />
    <Kpi label="TRADES TODAY" value={account ? `${account.tradedToday} / 1` : "—"} />
    <div style={{ height: 8 }} />
    <Kpi label="EQUITY (CAPPED)" value={eq == null ? "—" : "$" + fm(eq, 0)} sub={account && account.real_equity > account.equity ? `account $${fm(account.real_equity, 0)} · cap $${account.equity_cap}` : undefined} tone="gold" />
  </aside>;
}

export function Ticker() {
  const core = ["SOXL", "TQQQ", "INTC", "SOFI", "NIO", "RIVN", "LCID", "AAL", "MARA", "F", "PLTR", "AMD", "MU", "AAPL", "TSLA"];
  return <footer className="tick"><span>
    ◆ GLADIATOR SCALP ONLINE ◆ LIVE DATA OR AN EXPLICIT ERROR — NEVER SIM ◆ EVERY GATE ENFORCED IN CODE ◆ SCORE = |GAP%| + OR RVOL ◆ MIN 2.0 ◆ TOP-1 ONLY ◆ SPREAD ≤ 0.2% ◆ ORB15 LONG ◆ TRIGGER = 5M CLOSE &gt; OR-H &amp; VWAP ◆ STOP = OR LOW ◆ STOP ≤ 3% ◆ TARGET 1.5R ◆ FLAT 15:55 ET ◆ ONE TRADE / DAY ◆ COOLING-OFF AFTER A LOSS ◆ HALT &lt; $500 ◆ STAND DOWN AT 6% WEEKLY DD ◆ HUMAN APPROVAL REQUIRED ◆ n=5 IS AN ANECDOTE · n=40 IS VALIDATION · 100+ IS EVIDENCE ◆ NEVER CHASE ◆ {core.join(" · ")} ◆
  </span></footer>;
}

/* ---- ⌘K palette + single-key shortcuts ---- */
let openPalette: (() => void) | null = null;
function PaletteButton() { return <button className="icon-btn" onClick={() => openPalette && openPalette()} title="Command palette (Ctrl+K)">⌘K</button>; }
export function Palette() {
  const [on, setOn] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const router = useRouter();
  const items = ROUTES.filter(r => (r.n + " " + r.k).toLowerCase().includes(q.toLowerCase()));
  useEffect(() => { openPalette = () => { setOn(true); setQ(""); setIdx(0); }; return () => { openPalette = null; }; }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOn(true); setQ(""); setIdx(0); return; }
      if (e.key === "Escape") { setOn(false); return; }
      const t = e.target as HTMLElement;
      if (t && t.matches && t.matches("input,textarea,select,[contenteditable]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const r = ROUTES.find(x => x.key === e.key.toLowerCase());
      if (r) router.push(r.href);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [router]);
  if (!on) return null;
  const go = (href: string) => { setOn(false); router.push(href); };
  return <div className="overlay" onClick={() => setOn(false)}>
    <div className="box" onClick={e => e.stopPropagation()}>
      <input autoFocus value={q} placeholder="jump to floor, evidence, trades, lab…" onChange={e => { setQ(e.target.value); setIdx(0); }}
        onKeyDown={e => {
          if (e.key === "ArrowDown") setIdx(i => Math.min(items.length - 1, i + 1));
          if (e.key === "ArrowUp") setIdx(i => Math.max(0, i - 1));
          if (e.key === "Enter" && items[idx]) go(items[idx].href);
        }} />
      <div className="plist">{items.map((r, i) => <button key={r.href} className={i === idx ? "on" : ""} onClick={() => go(r.href)}>{r.n} <span className="muted mono">[{r.key}] {r.href}</span></button>)}</div>
    </div>
  </div>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState(false);
  return <div id="app">
    <Header onMenu={() => setMenu(m => !m)} />
    <Nav open={menu} onClose={() => setMenu(false)} />
    <main>{children}</main>
    <Side />
    <Ticker />
    <Palette />
  </div>;
}
