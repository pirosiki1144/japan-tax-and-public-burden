import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { formatAdapterRegistry, loadMonitoringRegistry } from "../scripts/composition/monitoring-registry.js";
import { buildMonitoringExecutionPlan } from "../scripts/cli/build-monitoring-execution-plan.js";
import { monitoringComposition } from "../scripts/composition/monitoring-composition.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtures = { html: "sample.html", pdf: "sample.pdf", csv: "sample.csv" };

test("every inventoried non-e-Gov format has an implementation or a concrete manual reason", async () => {
  const [registry, inventory] = await Promise.all([
    loadMonitoringRegistry(root),
    buildMonitoringExecutionPlan(root)
  ]);
  const formatsRegistry = formatAdapterRegistry(registry);
  const byFormat = new Map(formatsRegistry.map((entry) => [entry.format, entry]));
  const parserRegistry = monitoringComposition().registries.documentParsers;
  assert.deepEqual([...byFormat.keys()].sort(), ["csv", "html", "pdf", "spreadsheet"]);
  for (const entry of formatsRegistry) {
    if (entry.status === "implemented") {
      assert.equal(parserRegistry.has(entry.adapter), true);
      await access(`${root}/${entry.implementation}`);
      await access(`${root}/tests/fixtures/format-adapters/${fixtures[entry.format]}`);
    } else {
      assert.equal(entry.adapter, "manual");
      assert.ok(entry.manual_reason.length >= 20);
    }
  }
  const formats = new Set(inventory.targets.flatMap(({ sources }) => sources.map(({ official_format }) => official_format)).filter((format) => format !== "egov_law_api_json"));
  assert.ok([...formats].every((format) => byFormat.has(format)));
});
