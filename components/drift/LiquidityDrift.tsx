"use client";
/* Liquidity Drift — the live panel. Polls /api/flowstate every 20 s (never
   from inside the render loop), checks the payload against the shared
   contract, maps it onto the field and lets the sketch ease into it. Every
   driven slider has a LIVE / MAN toggle; MAN hands the parameter to the
   slider, LIVE eases it back from wherever the slider left it.
   This file talks to /api/flowstate only. */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "../HudProvider";
import { E } from "@/lib/engine-client";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import schemaModule from "@/lib/flowstate-schema.js";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import mapModule from "@/lib/drift-map.js";
import { createDrift, DEFAULTS, PALETTES, H, type DriftController, type LiveTargets, type Mode, type ParamKey, type Sampler } from "./sketch";

type Close = { r: number | null; agent: string | null; at: string | null };
type Flowstate = {
  asOf: string | null;
  session: { state: string | null; minutesElapsed: number | null; symbol: string | null } | null;
  agents: { name: string | null; openPositions: number | null; dayR: number | null; state: string | null }[] | null;
  recentCloses: Close[] | null;
  [k: string]: unknown;
};
const schema = schemaModule as unknown as { validate: (p: unknown) => { ok: boolean; errors: string[] } };
const dmap = mapModule as unknown as {
  targets: (p: Flowstate, h: number, riskPct: number) => LiveTargets & { closed: boolean };
  sampler: (c: Close[] | null) => Sampler;
  closeKey: (c: Close) => string;
};

const POLL_MS = 20_000;
const CLOSED_POLL_MS = 300_000;   // after hours: parameters frozen, only watch for the open

type Ctl = { key: ParamKey; label: string; hint: string; min: number; max: number; step: number; live: boolean; src?: string };
const CONTROLS: Ctl[] = [
  { key: "particleCount", label: "Open Positions", hint: "particles in flight", min: 400, max: 6000, step: 100, live: true, src: "800 + 600 × open positions" },
  { key: "flowSpeed", label: "Tick Velocity", hint: "how hard the field pushes", min: 0.2, max: 3, step: 0.1, live: true, src: "5-min realized vol" },
  { key: "noiseScale", label: "Regime Scale", hint: "size of trend structures", min: 0.001, max: 0.012, step: 0.0005, live: false },
  { key: "volatility", label: "Realized Volatility", hint: "turbulence octave weight", min: 0, max: 1.6, step: 0.05, live: true, src: "ATR % of price" },
  { key: "trailLength", label: "Trail Persistence", hint: "memory of the tape", min: 2, max: 40, step: 1, live: false },
  { key: "rangePull", label: "Level Magnetism", hint: "respect for the opening range", min: 0, max: 1.5, step: 0.05, live: true, src: "minutes into the session" },
  { key: "vortexCount", label: "Liquidity Pools", hint: "rotational singularities", min: 0, max: 9, step: 1, live: true, src: "one per active agent" },
  { key: "driftBias", label: "Trend Bias", hint: "long (+) / short (−) pressure", min: -1, max: 1, step: 0.05, live: true, src: "SMA20 slope in ATRs" },
  { key: "evolution", label: "Regime Evolution", hint: "how fast the field rewrites itself", min: 0, max: 1.5, step: 0.05, live: true, src: "session open / closed" },
  { key: "rUnit", label: "R Unit", hint: "pixels of drift per 1R", min: 30, max: 220, step: 5, live: true, src: "risk per trade on the price axis" }
];
const INTS = new Set<ParamKey>(["particleCount", "vortexCount", "trailLength", "rUnit"]);
const fmtV = (k: ParamKey, v: number) => (k === "noiseScale" ? v.toFixed(4) : INTS.has(k) ? String(Math.round(v)) : v.toFixed(2));

export default function LiquidityDrift() {
  const host = useRef<HTMLDivElement | null>(null);
  const ctl = useRef<DriftController | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const last = useRef<{ t: LiveTargets; s: Sampler } | null>(null);   // last good mapping, for a late-mounting sketch
  const [modes, setModes] = useState<Record<string, Mode>>(() => {
    const m: Record<string, Mode> = { structure: "live" };
    CONTROLS.forEach(c => { m[c.key] = c.live ? "live" : "manual"; });
    return m;
  });
  const [vals, setVals] = useState<Record<string, number>>({ ...DEFAULTS });
  const [seed, setSeed] = useState(12345);
  const [palette, setPalette] = useState("gladiator");
  const [paused, setPaused] = useState(false);
  const [feed, setFeed] = useState<{ ok: boolean; asOf: string | null; symbol: string | null; session: string | null; agents: number; closes: number; note: string }>({ ok: false, asOf: null, symbol: null, session: null, agents: 0, closes: 0, note: "connecting…" });

  /* mount the sketch once */
  useEffect(() => {
    let alive = true;
    const el = host.current;
    if (!el) return;
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void import("p5").then(mod => {
      if (!alive || !el) return;
      const c = createDrift(mod.default, el, { seed: 12345, reducedMotion: reduced, palette: PALETTES.gladiator });
      ctl.current = c;
      if (last.current) { c.setLive(last.current.t); c.setSampler(last.current.s); }
    });
    /* pause when off-screen or when the tab is hidden */
    let onScreen = true;
    const sync = () => ctl.current?.setVisible(onScreen && document.visibilityState === "visible");
    const io = new IntersectionObserver(es => { onScreen = es.some(e => e.isIntersecting); sync(); }, { threshold: 0.01 });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      alive = false;
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      ctl.current?.destroy(); ctl.current = null;
    };
  }, []);

  /* poll /api/flowstate; the render loop never waits on it */
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    async function poll() {
      try {
        const p = await apiGet<Flowstate>("/api/flowstate");
        const v = schema.validate(p);
        if (!v.ok) throw new Error("contract: " + v.errors[0]);
        const c = ctl.current;
        const t = dmap.targets(p, H, E.RULES.riskPct);
        /* after the bell: apply the closing state once, then hold it */
        if (!(closed && t.closed)) {
          last.current = { t, s: dmap.sampler(p.recentCloses) };
          c?.setLive(last.current.t);
          c?.setSampler(last.current.s);
        }
        closed = t.closed;
        /* one pulse per close we have not seen (none on the first read) */
        const closes = p.recentCloses || [];
        const keys = closes.map(dmap.closeKey);
        if (seen.current && c) {
          const fresh = closes.filter((x, i) => !seen.current!.has(keys[i]) && x.r != null).slice(-5);
          fresh.forEach(x => c.pulse(x.r as number, x.agent));
        }
        seen.current = new Set(keys);
        c?.setStale(false);
        setFeed({ ok: true, asOf: p.asOf, symbol: p.session?.symbol ?? null, session: p.session?.state ?? null,
          agents: (p.agents || []).filter(a => a.state === "active").length, closes: closes.length, note: "" });
      } catch (e) {
        /* keep the last good field, mark the edge, keep drawing */
        ctl.current?.setStale(true);
        setFeed(f => ({ ...f, ok: false, note: String((e as Error).message || e) }));
      }
      if (!stop) timer = setTimeout(() => void poll(), closed ? CLOSED_POLL_MS : POLL_MS);
    }
    void poll();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, []);

  /* show the eased values on the sliders that are LIVE */
  useEffect(() => {
    /* re-render the sidebar only when a shown value actually moved */
    const id = setInterval(() => {
      const c = ctl.current;
      if (!c) return;
      const next = c.values();
      setVals(prev => (CONTROLS.some(k => fmtV(k.key, prev[k.key] ?? 0) !== fmtV(k.key, next[k.key] ?? 0)) ? next : prev));
    }, 500);
    return () => clearInterval(id);
  }, []);

  const setMode = useCallback((k: ParamKey, m: Mode) => {
    setModes(s => ({ ...s, [k]: m }));
    ctl.current?.setMode(k, m);
  }, []);
  const onSlide = useCallback((k: ParamKey, v: number) => {
    setModes(s => (s[k] === "manual" ? s : { ...s, [k]: "manual" }));
    ctl.current?.setMode(k, "manual");
    ctl.current?.setManual(k, v);
    setVals(s => ({ ...s, [k]: v }));
  }, []);
  const reseed = (s: number) => { const v = Math.max(1, Math.floor(s) || 1); setSeed(v); ctl.current?.regenerate(v); };

  return <section className="view drift-view">
    <div className="view-head"><div><h2>LIQUIDITY DRIFT</h2>
      <p>The paper book as a flow field. Each particle is a position; its colour is R, its exits come from the journal.</p></div>
      <span className={"chip " + (feed.ok ? "ok" : feed.asOf ? "warn" : "dim")} title={feed.note}>
        {feed.ok ? `FLOW · ${feed.symbol ?? "—"} · ${feed.session === "open" ? "SESSION" : feed.session === "closed" ? "AFTER HOURS" : "NO SESSION DATA"} · ${new Date(feed.asOf || Date.now()).toLocaleTimeString()}`
          : feed.asOf ? "FLOW · HOLDING LAST GOOD" : "FLOW · SEEDED DEFAULTS"}
      </span>
    </div>
    <div className="drift-grid">
      <aside className="panel drift-side">
        <h3>Seed</h3>
        <input className="drift-seed" type="number" value={seed} onChange={e => reseed(parseInt(e.target.value, 10))} />
        <div className="drift-row">
          <button onClick={() => reseed(seed - 1)}>← Prev</button>
          <button onClick={() => reseed(seed + 1)}>Next →</button>
          <button onClick={() => reseed(Math.floor(Math.random() * 999999) + 1)}>↻ Random</button>
        </div>

        <h3>Parameters</h3>
        {CONTROLS.map(c => {
          const m = modes[c.key];
          const v = vals[c.key] ?? DEFAULTS[c.key as keyof typeof DEFAULTS];
          return <div className="drift-ctl" key={c.key}>
            <div className="drift-lab">
              <label htmlFor={"d-" + c.key}>{c.label}</label>
              {c.live ? <button className={"drift-mode " + m} title={m === "live" ? "driven by " + c.src + " — click to take manual control" : "manual — click to hand back to the data"}
                onClick={() => setMode(c.key, m === "live" ? "manual" : "live")}>{m === "live" ? "LIVE" : "MAN"}</button> : null}
            </div>
            <span className="hint">{c.hint}</span>
            <div className="drift-slider">
              <input id={"d-" + c.key} type="range" min={c.min} max={c.max} step={c.step} value={v}
                onChange={e => onSlide(c.key, parseFloat(e.target.value))} />
              <span className="mono">{fmtV(c.key, v)}</span>
            </div>
          </div>;
        })}
        <div className="drift-ctl">
          <div className="drift-lab"><label>Opening Range</label>
            <button className={"drift-mode " + modes.structure} onClick={() => setMode("structure", modes.structure === "live" ? "manual" : "live")}
              title="live = the OR high/low on the session price axis; manual = the seeded band">{modes.structure === "live" ? "LIVE" : "MAN"}</button></div>
          <span className="hint">the levels everything negotiates with</span>
        </div>

        <h3>Palette</h3>
        <select className="drift-select" value={palette} onChange={e => { setPalette(e.target.value); ctl.current?.setPalette(PALETTES[e.target.value]); }}>
          <option value="gladiator">Gladiator — ember / bone / jade</option>
          <option value="terminal">Terminal — classic tape</option>
          <option value="ice">Ice — cold book</option>
          <option value="ember">Ember — low-light desk</option>
        </select>

        <h3>Actions</h3>
        <div className="drift-row">
          <button onClick={() => ctl.current?.regenerate(seed)}>Regenerate</button>
          <button onClick={() => setPaused(ctl.current ? ctl.current.togglePause() : paused)}>{paused ? "Resume" : "Pause"}</button>
          <button onClick={() => ctl.current?.download()}>PNG</button>
        </div>
        <p className="muted drift-foot">{feed.agents} active agent{feed.agents === 1 ? "" : "s"} · exits drawn from {feed.closes} journal close{feed.closes === 1 ? "" : "s"}</p>
      </aside>
      <div className="drift-canvas" ref={host} />
    </div>
  </section>;
}
