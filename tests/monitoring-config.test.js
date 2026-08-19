import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildMonitoringConfig } from "../scripts/monitoring/build-monitoring-config.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("every canonical burden has one reproducible monitoring decision", async () => {
  const expected = await buildMonitoringConfig(root);
  const tracked = JSON.parse(await readFile(new URL("../config/monitoring.yaml", import.meta.url), "utf8"));

  assert.deepEqual(tracked, expected);
  assert.equal(tracked.targets.length, 112);
  assert.equal(new Set(tracked.targets.map(({ tax_id }) => tax_id)).size, 112);
});

test("automation is enabled only where an adapter and extraction targets exist", async () => {
  const { targets } = await buildMonitoringConfig(root);
  const automated = targets.filter(({ monitoring_mode }) => monitoring_mode === "automated");
  const manual = targets.filter(({ monitoring_mode }) => monitoring_mode === "manual");

  assert.deepEqual(automated.map(({ tax_id }) => tax_id), ["consumption-tax"]);
  assert.equal(manual.length, 111);
  assert.ok(automated[0].sources.length > 1);
  assert.ok(targets.every(({ sources }) => sources.every(({ target_url, extraction_targets }) => target_url.startsWith("https://") && extraction_targets.length > 0)));
});

test("multiple law sources and municipal scope remain explicit", async () => {
  const { targets } = await buildMonitoringConfig(root);
  const byId = new Map(targets.map((target) => [target.tax_id, target]));

  assert.equal(byId.get("medical-insurance-premium").sources.length, 3);
  assert.equal(byId.get("local-consumption-tax").municipal_scope, "issue_20");
  assert.match(byId.get("local-consumption-tax").notes, /#20/);
});
