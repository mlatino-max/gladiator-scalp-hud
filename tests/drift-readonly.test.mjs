/* Liquidity Drift: the read-only fence. Nothing in the panel or its data
   path may name an order route, and the browser half may only reach
   /api/flowstate. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

test("the Liquidity Drift panel and its data path stay read-only", () => {
  const files = ["lib/flowstate.js", "lib/flowstate-schema.js", "lib/drift-map.js", "app/api/flowstate/route.js", "app/drift/page.tsx"];
  const dir = "components/drift";
  for (const f of readdirSync(dir)) if (statSync(path.join(dir, f)).isFile()) files.push(path.join(dir, f));
  const banned = /submit_order|place_order|cancel_order|replace_order|close_position|method:\s*["'](POST|PUT|PATCH|DELETE)["']/i;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.ok(!banned.test(src), f + " mentions an order path");
  }
  /* the client never talks to Alpaca or holds a key name */
  for (const f of files.filter(f => f.startsWith("components") || f.startsWith("app/drift"))) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/alpaca\.markets|APCA|ALPACA_|lib\/alpaca/.test(src), f + " reaches past /api/flowstate");
  }
});
