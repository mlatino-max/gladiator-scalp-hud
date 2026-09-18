/* HERMES paper desk: the picture the `hermes` sidecar (docker/hermes) renders
   from the cloud sleeves' KV record onto the shared data volume. This module
   only reads files from that volume — it never talks to the broker or to KV,
   and on a deployment without the sidecar (Vercel) it reports "not rendered
   here" instead of guessing. */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PNG = "hermes_desk.png";
const STATUS = "status.json";

function hermesDir() {
  if (process.env.HERMES_DIR) return process.env.HERMES_DIR;
  return path.join(path.dirname(process.env.HUD_STORE_FILE || "/data/store.json"), "hermes");
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

/* { available, renderedAt, bytes, lastRun: {ok, at, message} | null } */
function deskStatus(dir) {
  dir = dir || hermesDir();
  let stat = null;
  try { stat = fs.statSync(path.join(dir, PNG)); } catch { /* no desk yet */ }
  return {
    available: !!stat,
    renderedAt: stat ? stat.mtime.toISOString() : null,
    bytes: stat ? stat.size : 0,
    lastRun: readJson(path.join(dir, STATUS))
  };
}

function readDesk(dir) {
  try { return fs.readFileSync(path.join(dir || hermesDir(), PNG)); } catch { return null; }
}

module.exports = { hermesDir, deskStatus, readDesk };
