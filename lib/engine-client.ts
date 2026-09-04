/* Typed façade over lib/engine.js for the React components. The engine is
   the single source of truth; this file only names its shapes. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
import engineModule from "./engine.js";
import type { Row, Ticket, Verdict, RoundTrip, Stats } from "./types";

type Engine = {
  RULES: {
    priceMin: number; priceMax: number; minScore: number; maxSpreadPct: number; maxStopPct: number; riskPct: number;
    targetR: number; minEquity: number; maxWeeklyDDPct: number; entryWindow: { start: number; end: number };
    orWindow: { start: number; end: number }; timeStop: string; equityCap: number; strategy: string;
    validation: { minTrades: number; minPF: number; minAvgR: number; maxDDPct: number; cleanLast: number };
    evidence: { anecdote: number; validation: number; evidence: number };
  };
  num: (x: unknown) => number | null;
  r2: (x: unknown) => number | null;
  minutesET: (d?: number | string | Date) => number;
  etDateStr: (d?: number | string | Date) => string;
  score: (row: Row) => number;
  inBand: (row: Row) => boolean;
  orWidthPct: (row: Row) => number | null;
  spreadPct: (row: Row) => number | null;
  rank: (rows: Row[]) => Row[];
  rowEligible: (row: Row) => { pass: boolean; fails: string[] };
  buildTicket: (row: Row | Record<string, unknown>, ctx: Record<string, unknown>) => Ticket;
  computeVerdict: (rows: Row[], ctx: Record<string, unknown>) => Verdict;
  tradeR: (entry: number | null, stop: number | null, exit: number | null) => number | null;
  evidenceTier: (n: number) => { tier: string; label: string; note: string };
  evidenceStats: (recs: RoundTrip[], opts?: Record<string, unknown>) => Stats;
  isFlat: (j: RoundTrip) => boolean;
  firstBlockingGate: (t: Ticket | null) => string | null;
};

export const E = engineModule as unknown as Engine;
export const RULES = E.RULES;
export const fm = (x: unknown, d = 2): string => {
  const n = typeof x === "number" ? x : typeof x === "string" ? parseFloat(x) : NaN;
  return Number.isFinite(n) ? n.toFixed(d) : "—";
};
export const fpf = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : x > 0 ? "∞" : "—");
export const fdate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false }); } catch { return iso; }
};
