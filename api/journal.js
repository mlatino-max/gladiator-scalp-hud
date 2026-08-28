/* GET /api/journal[?days=180]
   The journal comes from what actually happened at the broker: closed
   orders (nested, so bracket legs come along) reconstructed into round
   trips with entry, stop, target, exit, reason, and R. Nothing manual. */
"use strict";
const { fetchJournal, withGuard } = require("../lib/alpaca.js");

module.exports = withGuard(async (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt((req.query && req.query.days) || "180", 10) || 180));
  const entries = await fetchJournal(days);
  res.status(200).json({ asOf: new Date().toISOString(), days, count: entries.length, entries });
});
