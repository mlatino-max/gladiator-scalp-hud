/* Liquidity Drift's data path (/api/flowstate, copied by the Oracle feed to
   the Synaptic HUD's public feed/flowstate.json): the read-only fence.
   Nothing in it may name an order route. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the flowstate data path stays read-only", () => {
  const files = ["lib/flowstate.js", "lib/flowstate-schema.js", "app/api/flowstate/route.js"];
  const banned = /submit_order|place_order|cancel_order|replace_order|close_position|method:\s*["'](POST|PUT|PATCH|DELETE)["']/i;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.ok(!banned.test(src), f + " mentions an order path");
  }
});
