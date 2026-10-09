/* Liquidity Drift mappings: payload -> field parameters. Null in, null out
   (the panel keeps its seeded default); every mapping stays in its band. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const schema = require("../lib/flowstate-schema.js");
const dmap = require("../lib/drift-map.js");
const H = 900;

test("an all-null payload maps to no targets at all", () => {
  const t = dmap.targets(schema.emptyPayload(), H, 0.02);
  for (const k of ["driftBias", "volatility", "flowSpeed", "rangePull", "particleCount", "orHigh", "orLow", "rUnit", "evolution", "pools"]) {
    assert.equal(t[k], null, k);
  }
  assert.equal(t.closed, false);
  assert.equal(dmap.sampler(null), null);
});

test("the documented mappings, clamped to their bands", () => {
  const p = schema.emptyPayload();
  p.trend.slopeNormalized = 3;
  p.vol.atrPctOfPrice = 0.011;
  p.vol.realizedVol5m = 0.0001;
  p.session = { state: "open", minutesElapsed: 0, symbol: "QQQ" };
  p.book.openPositions = 3;
  p.agents = [{ name: "A", openPositions: 1, dayR: 0.4, state: "active" }, { name: "B", openPositions: 0, dayR: -1, state: "flat" }];
  const t = dmap.targets(p, H, 0.02);
  assert.equal(t.driftBias, 1);
  assert.ok(Math.abs(t.volatility - (0.15 + 0.5 * 1.35)) < 1e-9);
  assert.equal(t.flowSpeed, 0.4);
  assert.ok(Math.abs(t.rangePull - 1.3) < 1e-9);
  assert.equal(t.particleCount, 800 + 600 * 4);
  p.book.openPositions = 40;
  assert.equal(dmap.targets(p, H, 0.02).particleCount, 6000);
  p.session.minutesElapsed = 390;
  assert.ok(dmap.targets(p, H, 0.02).rangePull < 0.45);
});

test("one pool per ACTIVE agent; sign follows day R, radius grows with |day R|", () => {
  const p = schema.emptyPayload();
  p.agents = [
    { name: "WIN", openPositions: 1, dayR: 1.2, state: "active" },
    { name: "LOSE", openPositions: 2, dayR: -2.5, state: "active" },
    { name: "IDLE", openPositions: 0, dayR: 0, state: "flat" }
  ];
  const pools = dmap.targets(p, H, 0.02).pools;
  assert.deepEqual(pools.map(x => x.name), ["WIN", "LOSE"]);
  assert.ok(pools[0].s > 0 && pools[1].s < 0);
  assert.ok(pools[1].r > pools[0].r);
});

test("opening range lands between the session high and low on the canvas", () => {
  const p = schema.emptyPayload();
  p.price = { last: 512.44, sessionHigh: 515.10, sessionLow: 508.72, openRangeHigh: 511.80, openRangeLow: 509.15 };
  const t = dmap.targets(p, H, 0.02);
  assert.ok(t.orHigh < t.orLow, "higher price = higher on screen");
  assert.ok(t.orHigh > H * 0.08 && t.orLow < H * 0.92);
  /* y is linear in price on the session axis */
  const k = (t.orLow - t.orHigh) / (511.80 - 509.15);
  assert.ok(Math.abs((H * 0.84) / (515.10 - 508.72) - k) < 1e-9);
  assert.ok(t.rUnit >= 30 && t.rUnit <= 220);
  p.price.openRangeHigh = null;
  assert.equal(dmap.targets(p, H, 0.02).orHigh, null);
});

test("after the bell: slow drift, not a blank", () => {
  const p = schema.emptyPayload();
  p.session = { state: "closed", minutesElapsed: null, symbol: "SPY" };
  const t = dmap.targets(p, H, 0.02);
  assert.equal(t.closed, true);
  assert.equal(t.flowSpeed, 0.25);
  assert.equal(t.evolution, 0.08);
});

test("the exit sampler reproduces the book's win rate by construction", () => {
  /* 43 wins of +1.5R, 57 losses of -1R, spread through time */
  const closes = Array.from({ length: 100 }, (_, i) => ({ r: (i * 43) % 100 < 43 ? 1.5 : -1, agent: "X", at: "t" + i }));
  const s = dmap.sampler(closes);
  let wins = 0;
  const N = 200000;
  for (let i = 0; i < N; i++) if (s.draw((i + 0.5) / N) > 0) wins++;
  const recentWins = closes.slice(-50).filter(c => c.r > 0).length, olderWins = 43 - recentWins;
  const expected = (recentWins * 3 + olderWins) / (50 * 3 + 50);
  assert.ok(Math.abs(wins / N - expected) < 0.005, `${wins / N} vs ${expected}`);
  assert.ok(Math.abs(expected - 0.43) < 0.05);
});

test("the last 50 closes weigh three times the older ones", () => {
  const closes = [...Array.from({ length: 50 }, () => ({ r: -1 })), ...Array.from({ length: 50 }, () => ({ r: 2 }))];
  const s = dmap.sampler(closes);
  let pos = 0;
  for (let i = 0; i < 1000; i++) if (s.draw((i + 0.5) / 1000) > 0) pos++;
  assert.equal(pos, 750);
});
