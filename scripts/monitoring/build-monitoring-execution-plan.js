import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readYaml } from "../validate/schema-validator.js";
import { buildRuntimeMonitoringPlan } from "./build-monitoring-config.js";
import { loadMonitoringRegistry, registryByTaxId } from "./monitoring-registry.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
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

export async function buildMonitoringExecutionPlan(repositoryRoot) {
  const [monitoring, burdens, registry] = await Promise.all([
    buildRuntimeMonitoringPlan(repositoryRoot),
    readBurdens(repositoryRoot),
    loadMonitoringRegistry(repositoryRoot)
  ]);
  const decisions = registryByTaxId(registry);
  const burdenById = new Map(burdens.map((burden) => [burden.tax_id, burden]));
  const targets = monitoring.targets.filter(({ enabled }) => enabled).map((monitoringTarget) => {
    const burden = burdenById.get(monitoringTarget.tax_id);
    if (!burden) throw new Error(`${monitoringTarget.tax_id}: canonical burden is missing`);
    const expectedIssue = implementationIssue(burden);
    const canonical = decisions.get(burden.tax_id);
    if (!canonical) throw new Error(`${burden.tax_id}: canonical adapter decision is missing`);
    if (canonical.implementation_issue !== expectedIssue) throw new Error(`${burden.tax_id}: implementation issue must be ${expectedIssue}`);
    const issue = canonical.implementation_issue;
    const implementationPlan = {
      tax_id: canonical.tax_id,
      status: canonical.implementation_status === "implemented_initial" ? "implemented" : canonical.implementation_status,
      ...canonical.decision,
      ...(canonical.decision_kind === "public_manual" ? {
        hold_reason: `${canonical.decision.evidence_gap}。解除条件: ${canonical.decision.release_conditions.join("、")}。再確認: ${canonical.decision.recheck_cadence}`
      } : {})
    };
    const sources = monitoringTarget.sources.filter(({ enabled }) => enabled).map((source) => {
      const format = sourceFormat(source.target_url);
      const socialImplemented = issue === 44 && implementationPlan.status === "implemented" && implementationPlan.source_ids.includes(source.source_id);
      const socialHoldReason = issue === 44 && !socialImplemented
        ? implementationPlan.hold_reason ?? "制度根拠法令は保持するが、現行の率・金額は実装済みの年度別公式資料sourceから抽出する"
        : null;
      const publicImplemented = issue === 45 && implementationPlan.status === "implemented" && implementationPlan.source_ids.includes(source.source_id);
      const publicHoldReason = issue === 45 && !publicImplemented ? implementationPlan.hold_reason ?? "現行値は実装済みの公式資料sourceから抽出する" : null;
      return {
        source_id: source.source_id,
        target_id: source.target_id,
        official_format: format,
        current_adapter: source.adapter,
        required_adapter: requiredAdapter(format),
        adapter_status: socialImplemented || publicImplemented || (![44,45].includes(issue) && (["html", "pdf", "csv"].includes(format) || (format === "egov_law_api_json" && (issue === 39 || implementationPlan?.status === "implemented")))) ? "implemented" : implementationPlan?.status === "held" || [44,45].includes(issue) ? "held" : "planned",
        reuse_key: reuseKey(source),
        ...(implementationPlan?.status === "held" || socialHoldReason || publicHoldReason ? { hold_reason: socialHoldReason ?? publicHoldReason ?? implementationPlan.hold_reason } : {}),
        ...(format === "egov_law_api_json" ? {} : { shared_format_issue: 46 })
      };
    });
    if (!sources.length) throw new Error(`${monitoringTarget.tax_id}: enabled official source is missing`);
    return {
      tax_id: burden.tax_id,
      official_name: burden.official_name,
      burden_type: burden.burden_type,
      implementation_issue: issue,
      implementation_status: canonical.implementation_status,
      priority: issue === 39 || [42, 43, 44, 45].includes(issue) ? "completed" : "medium",
      depends_on_issues: issue === 39 ? [] : [31, ...(sources.some(({ official_format }) => official_format !== "egov_law_api_json") ? [46] : [])],
      batch_id: "pending",
      reuse_group: sources.map(({ reuse_key }) => reuse_key).sort().join("+"),
      municipal_scope: monitoringTarget.municipal_scope,
      capabilities: [42, 43, 44, 45].includes(issue) && implementationPlan.status === "implemented" ? Object.fromEntries(Object.keys(capabilityPlan(burden.tax_id)).map((key) => [key, "implemented"])) : capabilityPlan(burden.tax_id),
      sources
    };
  }).sort((left, right) => left.tax_id.localeCompare(right.tax_id, "en"));
  assignBatches(targets);
  return {
    schema_version: 1,
    generated_at: registry.metadata.execution_plan_generated_at,
    batch_policy: { default_max_targets: DEFAULT_BATCH_SIZE, hard_max_targets: MAX_BATCH_SIZE, common_source_exception: "one_common_source_unit" },
    targets
  };
}

export function validateExecutionCoverage(executionPlan, monitoring) {
  const errors = [];
  const enabled = monitoring.targets.filter(({ enabled }) => enabled).map(({ tax_id }) => tax_id).sort();
  const inventoried = executionPlan.targets.map(({ tax_id }) => tax_id).sort();
  if (new Set(inventoried).size !== inventoried.length) errors.push("monitoring execution plan contains duplicate tax_id values");
  const missing = enabled.filter((taxId) => !inventoried.includes(taxId));
  const extra = inventoried.filter((taxId) => !enabled.includes(taxId));
  if (missing.length) errors.push(`monitoring execution plan has unassigned targets: ${missing.join(", ")}`);
  if (extra.length) errors.push(`monitoring execution plan has unknown targets: ${extra.join(", ")}`);
  const batches = new Map();
  for (const target of executionPlan.targets) {
    if (!batches.has(target.batch_id)) batches.set(target.batch_id, []);
    batches.get(target.batch_id).push(target);
  }
  for (const [batchId, targets] of batches) {
    if (targets.length <= MAX_BATCH_SIZE) continue;
    if (new Set(targets.map(({ reuse_group }) => reuse_group)).size !== 1) errors.push(`${batchId}: ${targets.length} targets exceed the batch limit without one common source`);
  }
  for (const target of executionPlan.targets) {
    if (target.burden_type === "local_tax" && target.municipal_scope !== "issue_20") errors.push(`${target.tax_id}: local tax municipality scope must remain in Issue #20`);
    const implemented = target.sources.filter(({ adapter_status: status }) => status === "implemented");
    const held = target.sources.filter(({ adapter_status: status }) => status === "held");
    if (target.implementation_status === "implemented" && implemented.length === 0) errors.push(`${target.tax_id}: implemented target has no implemented source`);
    if (target.implementation_status === "held" && held.length === 0) errors.push(`${target.tax_id}: manual target has no held source`);
    for (const source of held) if (!source.hold_reason || source.hold_reason.length < 20) errors.push(`${target.tax_id}/${source.target_id}: manual reason is missing`);
  }
  return errors;
}

async function run() {
  const executionPlan = await buildMonitoringExecutionPlan(root);
  const monitoring = await buildRuntimeMonitoringPlan(root);
  const coverageErrors = validateExecutionCoverage(executionPlan, monitoring);
  if (coverageErrors.length) throw new Error(coverageErrors.join("\n"));
  console.log(JSON.stringify({ status: "clean", targets: executionPlan.targets.length, batches: new Set(executionPlan.targets.map(({ batch_id }) => batch_id)).size }));
}

if (process.argv[1] && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url))) {
  run().catch((error) => {
    console.error(JSON.stringify({ status: "error", error: error.message }));
    process.exitCode = 1;
  });
}
