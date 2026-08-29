import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_OUTPUT = "reports/architecture-inventory.json";
const DERIVED = new Set([
  "docs/monitoring-extraction-target-review.md",
  "generated/public-burdens.csv",
  "reports/architecture-inventory.json"
]);
const CLI_NAMES = /^(audit-repository|audit-source-scan|publish-audit-issues|adapter-coverage-audit|prepare-update|public-burden-csv|build-monitoring-execution-plan|build-monitoring-config|extract-egov-tax-semantics|write-semantic-baseline|run-monitoring|scan-source|validate-data|architecture-inventory)\.js$/;

function trackedFiles(root) {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
    .trim().split("\n").filter((path) => path && existsSync(join(root, path))).sort();
}

export function classifyFile(path) {
  const name = path.split("/").at(-1);
  if (DERIVED.has(path)) return "derived_artifact";
  if (path.startsWith("tests/fixtures/") || path.endsWith("/.gitkeep")) return "fixture";
  if (path.startsWith("tests/")) return "test";
  if (path.startsWith("docs/") || path === "README.md" || path === "PROJECT_SPEC.md" || path === "AGENTS.md") return "documentation";
  if (path.startsWith("schemas/") || path.startsWith("config/") || path.startsWith("data/")) return "source_of_truth";
  if (path.startsWith(".github/") || [".gitignore", "package.json", "package-lock.json"].includes(path)) return "repository_support";
  if (path.startsWith("scripts/") && CLI_NAMES.test(name)) return "cli";
  if (path.startsWith("scripts/pipeline/") || path.startsWith("scripts/generate/") || path.startsWith("scripts/automation/")) return "application";
  if (path.startsWith("scripts/adapters/") || path.startsWith("scripts/fetch/") || path.startsWith("scripts/formats/") || path === "scripts/validate/schema-validator.js") return "adapter";
  if (path.startsWith("scripts/application/")) return "application";
  if (path.startsWith("scripts/composition/")) return "composition_root";
  if (path.startsWith("scripts/")) return "domain";
  return "unclassified";
}

function relativeImports(source) {
  return [...source.matchAll(/(?:import|export)[^"']*?["'](\.{1,2}\/[^"']+)["']/g)].map((match) => match[1]);
}

function resolveImport(from, specifier, files) {
  const base = normalize(join(dirname(from), specifier)).replaceAll("\\", "/");
  for (const candidate of [base, `${base}.js`, `${base}/index.js`]) if (files.has(candidate)) return candidate;
  return null;
}

function findCycles(graph) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  function visit(node) {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      cycles.push([...stack.slice(start), node]);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const target of graph[node] ?? []) visit(target);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }
  for (const node of Object.keys(graph)) visit(node);
  return cycles;
}

export function forbiddenDependencies(graph) {
  const errors = [];
  for (const [source, targets] of Object.entries(graph)) {
    for (const target of targets) {
      if (source.startsWith("scripts/application/") && /scripts\/(?:adapters|composition|fetch|formats|pipeline)\//.test(target)) errors.push(`${source} -> ${target}`);
      if (source.startsWith("scripts/adapters/") && /scripts\/(?:application|composition|pipeline)\//.test(target)) errors.push(`${source} -> ${target}`);
    }
  }
  return errors.sort();
}

async function yaml(root, path) {
  return parse(await readFile(join(root, path), "utf8"));
}

async function configurationMetrics(root) {
  const registry = await yaml(root, "config/monitoring.yaml");
  const registryIds = new Set(registry.targets.map(({ tax_id: id }) => id));
  const decisionIds = new Set(registry.targets.filter(({ implementation_issue: issue }) => issue !== 39).map(({ tax_id: id }) => id));
  return {
    canonical_registry_targets: registryIds.size,
    post_initial_decision_targets: decisionIds.size,
    initial_implementation_targets: [...registryIds].filter((id) => !decisionIds.has(id)).sort(),
    manually_edited_decision_files: 1,
    canonical_target_file: "config/monitoring.yaml",
    persisted_derived_target_files: [],
    in_memory_views: ["runtime monitoring plan", "monitoring execution plan", "category decision views"]
  };
}

export async function buildArchitectureInventory(root = ROOT) {
  const files = trackedFiles(root);
  const fileSet = new Set(files);
  const javascript = files.filter((path) => extname(path) === ".js");
  const graph = {};
  let edgeCount = 0;
  const fsUsers = [];
  const atomicWriters = [];
  for (const path of javascript) {
    const source = await readFile(join(root, path), "utf8");
    graph[path] = relativeImports(source).map((specifier) => resolveImport(path, specifier, fileSet)).filter(Boolean);
    edgeCount += graph[path].length;
    if (/node:fs(?:\/promises)?/.test(source)) fsUsers.push(path);
    if (/\bwriteFile\b/.test(source) && /\brename\b/.test(source)) atomicWriters.push(path);
  }
  const classified = files.map((path) => ({ path, responsibility: classifyFile(path) }));
  const counts = Object.fromEntries([...new Set(classified.map(({ responsibility }) => responsibility))]
    .sort().map((responsibility) => [responsibility, classified.filter((entry) => entry.responsibility === responsibility).length]));
  return {
    schema_version: 1,
    scope: "tracked repository files",
    baseline_commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    totals: { tracked_files: files.length, javascript_files: javascript.length, import_edges: edgeCount },
    responsibilities: counts,
    files: classified,
    import_graph: { cycles: findCycles(graph), forbidden_edges: forbiddenDependencies(graph), adjacency: graph },
    configuration_overlap: await configurationMetrics(root),
    io_duplication: {
      filesystem_importing_files: fsUsers.length,
      atomic_write_implementations: atomicWriters.length,
      filesystem_users: fsUsers,
      atomic_writers: atomicWriters
    },
    change_surface: {
      current_automated_existing_target_manual_edits: ["config/sources.yaml", "config/monitoring.yaml"],
      current_derived_files_regenerated: ["docs/monitoring-extraction-target-review.md"],
      target_after_issue_71_manual_edits: ["config/sources.yaml", "config/monitoring.yaml"]
    }
  };
}

async function main() {
  const check = process.argv.includes("--check");
  const outputIndex = process.argv.indexOf("--output");
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : DEFAULT_OUTPUT;
  const report = await buildArchitectureInventory(ROOT);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (check) {
    const existing = JSON.parse(await readFile(join(ROOT, output), "utf8"));
    // The baseline commit records when the inventory was reviewed; it is not a generated-drift signal.
    report.baseline_commit = existing.baseline_commit;
    const comparable = `${JSON.stringify(report, null, 2)}\n`;
    if (comparable !== `${JSON.stringify(existing, null, 2)}\n`) throw new Error(`${output} is stale; run npm run architecture:audit`);
    if (report.import_graph.cycles.length) throw new Error(`circular imports are forbidden: ${report.import_graph.cycles.join("; ")}`);
    if (report.import_graph.forbidden_edges.length) throw new Error(`forbidden dependencies: ${report.import_graph.forbidden_edges.join("; ")}`);
    console.log(JSON.stringify({ status: "clean", files: report.totals.tracked_files, cycles: report.import_graph.cycles.length }));
    return;
  }
  await writeFile(join(ROOT, output), serialized);
  console.log(JSON.stringify({ status: "written", output, files: report.totals.tracked_files, cycles: report.import_graph.cycles.length }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
