"use client";
/* One data layer for every screen. Polls /api/scan + /api/account, holds
   the LIVE / STALE / ERROR state, and computes the verdict with the same
   engine the server uses. There is no SIM state anywhere in this app. */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { E } from "@/lib/engine-client";
import type { Account, DataState, Scan, Ticket, Verdict } from "@/lib/types";

export type HudError = { status: number | null; endpoint: string; message: string; hint?: string; at: string };
type Hud = {
  state: DataState; scan: Scan | null; account: Account | null; verdict: Verdict | null;
  lastOk: string | null; errors: HudError[]; refreshing: boolean;
  refresh: () => Promise<void>; ageSec: number; strategy: string; strategies: string[]; setStrategy: (s: string) => void;
  minutesET: () => number; ctx: () => Record<string, unknown>; staged: Ticket | null; setStaged: (t: Ticket | null) => void;
};
const Ctx = createContext<Hud | null>(null);

export async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(path, { cache: "no-store", credentials: "same-origin" });
  let j: Record<string, unknown> = {};
  try { j = await r.json(); } catch { /* empty body */ }
  if (!r.ok) {
    const e = new Error(String(j.error || `HTTP ${r.status}`)) as Error & { status?: number; hint?: string };
    e.status = r.status; e.hint = j.hint as string | undefined;
    throw e;
  }
  return j as T;
}

const STALE_MS = 120_000;

export function HudProvider({ children }: { children: React.ReactNode }) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const [errors, setErrors] = useState<HudError[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const [strategy, setStrategy] = useState<string>(E.RULES.strategy);
  const [staged, setStaged] = useState<Ticket | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    setRefreshing(true);
    const errs: HudError[] = [];
    const [s, a] = await Promise.allSettled([apiGet<Scan>("/api/scan"), apiGet<Account>("/api/account")]);
    const now = new Date().toISOString();
    if (s.status === "fulfilled") setScan(s.value);
    else errs.push({ status: (s.reason as { status?: number }).status ?? null, endpoint: "/api/scan", message: String(s.reason?.message || s.reason), hint: (s.reason as { hint?: string }).hint, at: now });
    if (a.status === "fulfilled") setAccount(a.value);
    else errs.push({ status: (a.reason as { status?: number }).status ?? null, endpoint: "/api/account", message: String(a.reason?.message || a.reason), hint: (a.reason as { hint?: string }).hint, at: now });
    if (s.status === "fulfilled" && a.status === "fulfilled") setLastOk(now);
    setErrors(errs);
    setRefreshing(false);
    const open = s.status === "fulfilled" && s.value.clock?.is_open;
    timer.current = setTimeout(() => { void refresh(); }, errs.length ? 60_000 : open ? 30_000 : 300_000);
  }, []);

  useEffect(() => { void refresh(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [refresh]);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(id); }, []);

  const ageSec = lastOk ? Math.max(0, Math.round((Date.now() - new Date(lastOk).getTime()) / 1000)) : -1;
  const haveBoth = !!scan && !!account;
  const state: DataState = !haveBoth ? (errors.length ? "ERROR" : "LOADING")
    : errors.length ? "ERROR" : (ageSec * 1000 > STALE_MS ? "STALE" : "LIVE");

  const minutesET = useCallback(() => {
    if (scan && scan.etNowMin != null) {
      return scan.etNowMin + Math.max(0, Math.round((Date.now() - new Date(scan.asOf).getTime()) / 60000));
    }
    return E.minutesET(new Date());
  }, [scan]);
  const ctx = useCallback(() => ({
    equity: account?.equity ?? 0, coolingOff: !!account?.coolingOff, weeklyDDPct: account?.weeklyDDPct ?? 0,
    tradedToday: account?.tradedToday ?? 0, minutesET: minutesET()
  }), [account, minutesET]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const verdict = useMemo(() => (haveBoth ? E.computeVerdict(scan!.rows, ctx()) : null), [scan, account, Math.floor(tick / 30)]);

  const value: Hud = {
    state, scan, account, verdict, lastOk, errors, refreshing, refresh, ageSec,
    strategy, strategies: [E.RULES.strategy], setStrategy, minutesET, ctx, staged, setStaged
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useHud(): Hud {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHud outside HudProvider");
  return v;
}
