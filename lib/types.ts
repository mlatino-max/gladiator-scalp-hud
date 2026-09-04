/* Shapes shared by the client components. The engine is the source of
   truth; these only describe what it returns. */
export type Gate = { key: string; label: string; pass: boolean; detail: string; blocking: boolean };
export type Ticket = {
  ok: boolean; armed: boolean; reasons: string[]; gates: Gate[];
  symbol: string; setup: string; score: number | null; gap_pct: number | null; rvol: number | null;
  spread_pct: number | null; vwap: number | null; last_close_5m: number | null;
  entry_est: number | null; stop: number | null; target: number | null; shares: number;
  position_value: number | null; dollars_at_risk: number | null;
  entry_trigger: string; time_stop: string; order_type: string;
  or_high: number | null; or_low: number | null; price: number | null;
};
export type Row = {
  symbol: string; price: number | null; prevClose: number | null; gap: number | null; rvol: number | null;
  orh: number | null; orl: number | null; orReady: boolean; vwap: number | null; lastClose5m: number | null;
  bid: number | null; ask: number | null; spreadPct: number | null; volume: number | null; core: boolean; dyn: boolean;
  score?: number; rankScore?: number; tier?: number;
};
export type Scan = {
  asOf: string; etDate: string; etNowMin: number; sessionStarted: boolean;
  clock: { is_open: boolean; next_open: string; next_close: string; timestamp?: string };
  feed: string; rows: Row[]; index: Record<string, { price: number | null; gap: number | null }>;
};
export type Account = {
  asOf: string; etDate: string; paper: boolean; account_number: string; status: string; currency: string;
  equity: number; real_equity: number; equity_cap: number; cash: number | null; buying_power: number | null;
  weeklyDDPct: number; weeklyDDDollars: number; weekPeakEquity: number; prevTradingDay: string | null;
  prevDayR: number | null; coolingOff: boolean; coolingDetail: string; tradedToday: number;
  clock: { is_open: boolean; next_open: string; next_close: string };
};
export type Verdict = {
  verdict: "TRADE_ARMED" | "STAGED" | "NO_TRADE" | "NO_DATA"; top: string | null; score: number | null;
  eligibleCount?: number; candidateCount?: number; reason: string; ticket: Ticket | null; ranked: Row[];
};
export type Fill = { id: string; side: "buy" | "sell"; qty: number; price: number | null; at: string; kind: string };
export type RoundTrip = {
  id: string; src: "alpaca" | "manual"; strategy: string; date: string; entryAt: string; symbol: string;
  qty: number; entry: number | null; stop: number | null; target: number | null; exit: number | null;
  exitDate: string | null; exitAt: string | null; matchedQty: number; r: number | null; reason: string;
  pnl: number | null; exitKinds: string[]; fills: Fill[]; breaches: string[]; breachRulesVersion: number;
  regime?: string;
};
export type EvidenceGate = { key: string; label: string; value: number; threshold: number; op: string; pass: boolean; noise: boolean };
export type Stats = {
  strategy: string; n: number; pf: number; avgR: number; winRate: number; maxDDPct: number;
  equityPath: number[]; rPath: number[]; pnlPath: number[]; breachesLast20: number; breachCounts: Record<string, number>;
  windowSize: number; mixedRuleVersions: boolean; excluded: { noStop: number; badR: number; partial: number; open: number; total: number };
  flatCount: number; totalCount: number; gates: EvidenceGate[]; goLive: boolean;
  tier: { tier: string; label: string; note: string }; verdict: string; failing: string[];
};
export type RegimeSnapshot = { date: string; regime: string; spyClose?: number | null; sma20?: number | null; sma50?: number | null; breadth?: number | null; source?: string; capturedAt?: string };
export type Evidence = {
  asOf: string; strategy: string; days: number; entries: RoundTrip[]; stats: Stats;
  regime: { snapshots: Record<string, RegimeSnapshot>; breakdown: { regime: string; n: number; pf: number; avgR: number; winRate: number }[] };
  gateBlocks: { days: number; noTradeDays: number; blockers: { gate: string; days: number }[] };
  verdictDays: { date: string; verdict: string; top: string | null; firstBlock: string | null; at?: string }[];
  cache: { syncedAt: string; count: number; drift: boolean } | null; store: string;
};
export type DataState = "LIVE" | "STALE" | "ERROR" | "LOADING";
