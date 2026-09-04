/* Push alerts: facts only, de-duplicated through the store. Channel is an
   HTTP POST to ALERT_PUSH_URL (ntfy-compatible: title header + text body).
   No URL configured → alerts are recorded as "unsent" and nothing is thrown;
   a missing channel must never take the page down. */
"use strict";
const { getAlertState, setAlertState } = require("./store.js");

async function push(title, body, priority) {
  const url = process.env.ALERT_PUSH_URL;
  if (!url) return { sent: false, reason: "ALERT_PUSH_URL not set" };
  const headers = { "content-type": "text/plain", title: String(title).slice(0, 120) };
  if (priority) headers.priority = String(priority);
  if (process.env.ALERT_PUSH_TOKEN) headers.authorization = `Bearer ${process.env.ALERT_PUSH_TOKEN}`;
  const res = await fetch(url, { method: "POST", headers, body: String(body) });
  return { sent: res.ok, status: res.status };
}

/* fire once per (strategy, key, value): the same state seen again is silent */
async function alertOnce(strategy, k, value, title, body, priority) {
  const prev = await getAlertState(strategy, k);
  if (prev && prev.value === value) return { sent: false, reason: "unchanged", value };
  const r = await push(title, body, priority);
  await setAlertState(strategy, k, { value, sentAt: new Date().toISOString(), ...r });
  return { ...r, value };
}

/* Evaluate every trigger from a fresh verdict + stats. Returns what fired. */
async function evaluate(strategy, { etDate, verdict, ticket, tier, plumbing }) {
  const fired = [];
  if (verdict === "TRADE_ARMED" && ticket) {
    const r = await alertOnce(strategy, `ticket_armed:${etDate}`, "armed",
      `TRADE_ARMED ${ticket.symbol}`,
      `${etDate} ${ticket.symbol} entry ${ticket.entry_est} stop ${ticket.stop} target ${ticket.target} qty ${ticket.shares} risk $${ticket.dollars_at_risk}. Needs human --approve.`,
      "high");
    if (r.sent) fired.push("ticket_armed");
  }
  if (verdict && ticket && ticket.gates) {
    const failing = ticket.gates.filter(g => g.blocking && !g.pass).map(g => g.key).join(",") || "none";
    const r = await alertOnce(strategy, `gates:${etDate}`, failing,
      `Gate state ${etDate}`, `${ticket.symbol}: blocking gates failing: ${failing}`);
    if (r.sent) fired.push("gate_flip");
  }
  if (tier) {
    const r = await alertOnce(strategy, "tier", tier.tier, `Evidence tier ${tier.tier}`, tier.label + " — " + tier.note);
    if (r.sent) fired.push("tier");
  }
  if (plumbing) {
    const r = await alertOnce(strategy, `plumbing:${plumbing.key}`, plumbing.value,
      `PLUMBING ${plumbing.key}`, plumbing.detail, "high");
    if (r.sent) fired.push("plumbing");
  }
  return fired;
}

module.exports = { push, alertOnce, evaluate };
