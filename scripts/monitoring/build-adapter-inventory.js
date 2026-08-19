import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readYaml } from "../validate/schema-validator.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputPath = join(root, "config/adapter-inventory.yaml");
const DEFAULT_BATCH_SIZE = 15;
const MAX_BATCH_SIZE = 20;

async function readBurdens(repositoryRoot) {
  const burdens = [];
  for (const entry of await readdir(join(repositoryRoot, "data/burdens"), { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:json|ya?ml)$/.test(entry.name)) continue;
    const document = await readYaml(join(repositoryRoot, "data/burdens", entry.name));
    burdens.push(...(Array.isArray(document) ? document : [document]));
  }
  return burdens;
}

function implementationIssue(burden) {
  if (["consumption-tax", "automobile-tax"].includes(burden.tax_id)) return 39;
  if (burden.burden_type === "national_tax") return 42;
  if (burden.burden_type === "local_tax") return 43;
  if (burden.burden_type === "social_insurance_premium") return 44;
  return 45;
}

function sourceFormat(url) {
  const parsed = new URL(url);
  if (parsed.hostname === "laws.e-gov.go.jp" && parsed.pathname.startsWith("/api/2/law_data/")) return "egov_law_api_json";
  const extension = extname(parsed.pathname).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if (extension === ".csv") return "csv";
  if ([".xls", ".xlsx", ".ods"].includes(extension)) return "spreadsheet";
  return "html";
}

function requiredAdapter(format) {
  return `${format === "egov_law_api_json" ? "egov_law" : format}_semantics`;
}

function reuseKey(source) {
  const format = sourceFormat(source.target_url);
  return `${format}:${format === "egov_law_api_json" ? source.target_id : new URL(source.target_url).hostname}`;
}

function capabilityPlan(taxId) {
  if (taxId === "consumption-tax") return {
    liable_party: "implemented", taxable_scope: "implemented", calculation_basis: "implemented", rate_or_amount: "implemented", applicable_period: "planned"
  };
  if (taxId === "automobile-tax") return {
    liable_party: "implemented", taxable_scope: "planned", calculation_basis: "planned", rate_or_amount: "implemented", applicable_period: "planned"
  };
  return {
    liable_party: "needs_source_research", taxable_scope: "needs_source_research", calculation_basis: "needs_source_research", rate_or_amount: "needs_source_research", applicable_period: "needs_source_research"
  };
}

function assignBatches(targets) {
  for (const issue of [39, 42, 43, 44, 45]) {
    const issueTargets = targets.filter((target) => target.implementation_issue === issue);
    const groups = new Map();
    for (const target of issueTargets) {
      const key = target.reuse_group;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(target);
    }
    let batch = [];
    let sequence = 1;
    const flush = () => {
      if (!batch.length) return;
      const batchId = `issue-${issue}-batch-${String(sequence).padStart(2, "0")}`;
      batch.forEach((target) => { target.batch_id = batchId; });
      batch = [];
      sequence += 1;
    };
    for (const group of [...groups.values()].sort((left, right) => left[0].reuse_group.localeCompare(right[0].reuse_group, "en"))) {
      if (group.length > MAX_BATCH_SIZE) {
        flush();
        const batchId = `issue-${issue}-common-source-${String(sequence).padStart(2, "0")}`;
        group.forEach((target) => { target.batch_id = batchId; });
        sequence += 1;
      } else {
        if (batch.length && batch.length + group.length > DEFAULT_BATCH_SIZE) flush();
        batch.push(...group);
      }
    }
    flush();
  }
}

export async function buildAdapterInventory(repositoryRoot) {
  const [monitoring, burdens] = await Promise.all([
    readYaml(join(repositoryRoot, "config/monitoring.yaml")),
    readBurdens(repositoryRoot)
  ]);
  const burdenById = new Map(burdens.map((burden) => [burden.tax_id, burden]));
  const targets = monitoring.targets.filter(({ enabled }) => enabled).map((monitoringTarget) => {
    const burden = burdenById.get(monitoringTarget.tax_id);
    if (!burden) throw new Error(`${monitoringTarget.tax_id}: canonical burden is missing`);
    const issue = implementationIssue(burden);
    const sources = monitoringTarget.sources.filter(({ enabled }) => enabled).map((source) => {
      const format = sourceFormat(source.target_url);
      return {
        source_id: source.source_id,
        target_id: source.target_id,
        official_format: format,
        current_adapter: source.adapter,
        required_adapter: requiredAdapter(format),
        adapter_status: issue === 39 && format === "egov_law_api_json" ? "implemented" : "planned",
        reuse_key: reuseKey(source),
        ...(format === "egov_law_api_json" ? {} : { shared_format_issue: 46 })
      };
    });
    if (!sources.length) throw new Error(`${monitoringTarget.tax_id}: enabled official source is missing`);
    return {
      tax_id: burden.tax_id,
      official_name: burden.official_name,
      burden_type: burden.burden_type,
      implementation_issue: issue,
      implementation_status: issue === 39 ? "implemented_initial" : "planned",
      priority: issue === 39 ? "completed" : [42, 43, 44].includes(issue) ? "high" : "medium",
      depends_on_issues: issue === 39 ? [] : [31, ...(sources.some(({ official_format }) => official_format !== "egov_law_api_json") ? [46] : [])],
      batch_id: "pending",
      reuse_group: sources.map(({ reuse_key }) => reuse_key).sort().join("+"),
      municipal_scope: monitoringTarget.municipal_scope,
      capabilities: capabilityPlan(burden.tax_id),
      sources
    };
  }).sort((left, right) => left.tax_id.localeCompare(right.tax_id, "en"));
  assignBatches(targets);
  return {
    schema_version: 1,
    generated_at: monitoring.generated_at,
    batch_policy: { default_max_targets: DEFAULT_BATCH_SIZE, hard_max_targets: MAX_BATCH_SIZE, common_source_exception: "one_common_source_unit" },
    targets
  };
}

export function validateInventoryCoverage(inventory, monitoring) {
  const errors = [];
  const enabled = monitoring.targets.filter(({ enabled }) => enabled).map(({ tax_id }) => tax_id).sort();
  const inventoried = inventory.targets.map(({ tax_id }) => tax_id).sort();
  if (new Set(inventoried).size !== inventoried.length) errors.push("adapter inventory contains duplicate tax_id values");
  const missing = enabled.filter((taxId) => !inventoried.includes(taxId));
  const extra = inventoried.filter((taxId) => !enabled.includes(taxId));
  if (missing.length) errors.push(`adapter inventory has unassigned targets: ${missing.join(", ")}`);
  if (extra.length) errors.push(`adapter inventory has unknown targets: ${extra.join(", ")}`);
  const batches = new Map();
  for (const target of inventory.targets) {
    if (!batches.has(target.batch_id)) batches.set(target.batch_id, []);
    batches.get(target.batch_id).push(target);
  }
  for (const [batchId, targets] of batches) {
    if (targets.length <= MAX_BATCH_SIZE) continue;
    if (new Set(targets.map(({ reuse_group }) => reuse_group)).size !== 1) errors.push(`${batchId}: ${targets.length} targets exceed the batch limit without one common source`);
  }
  for (const target of inventory.targets) {
    if (target.burden_type === "local_tax" && target.municipal_scope !== "issue_20") errors.push(`${target.tax_id}: local tax municipality scope must remain in Issue #20`);
  }
  return errors;
}

async function run() {
  const check = process.argv.includes("--check");
  const inventory = await buildAdapterInventory(root);
  const monitoring = await readYaml(join(root, "config/monitoring.yaml"));
  const coverageErrors = validateInventoryCoverage(inventory, monitoring);
  if (coverageErrors.length) throw new Error(coverageErrors.join("\n"));
  const content = `${JSON.stringify(inventory, null, 2)}\n`;
  if (check) {
    if (await readFile(outputPath, "utf8") !== content) throw new Error("config/adapter-inventory.yaml differs from canonical monitoring targets");
    console.log(JSON.stringify({ status: "clean", targets: inventory.targets.length, batches: new Set(inventory.targets.map(({ batch_id }) => batch_id)).size }));
    return;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, outputPath);
  console.log(JSON.stringify({ status: "generated", targets: inventory.targets.length }));
}

if (process.argv[1] && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url))) {
  run().catch((error) => {
    console.error(JSON.stringify({ status: "error", error: error.message }));
    process.exitCode = 1;
  });
}
