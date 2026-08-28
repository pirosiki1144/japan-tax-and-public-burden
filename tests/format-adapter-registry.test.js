import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readYaml } from "../scripts/validate/schema-validator.js";
import { buildMonitoringExecutionPlan } from "../scripts/monitoring/build-monitoring-execution-plan.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("every inventoried non-e-Gov format has an implementation or a concrete manual reason", async () => {
  const [registry, inventory] = await Promise.all([
    readYaml(new URL("../config/format-adapters.yaml", import.meta.url)),
    buildMonitoringExecutionPlan(root)
  ]);
  const byFormat = new Map(registry.formats.map((entry) => [entry.format, entry]));
  assert.deepEqual([...byFormat.keys()].sort(), ["csv", "html", "pdf", "spreadsheet"]);
  for (const entry of registry.formats) {
    if (entry.status === "implemented") {
      await access(`${root}/${entry.implementation}`);
      await access(`${root}/${entry.test_fixture}`);
    } else {
      assert.equal(entry.adapter, "manual");
      assert.ok(entry.manual_reason.length >= 20);
    }
  }
  const formats = new Set(inventory.targets.flatMap(({ sources }) => sources.map(({ official_format }) => official_format)).filter((format) => format !== "egov_law_api_json"));
  assert.ok([...formats].every((format) => byFormat.has(format)));
});
