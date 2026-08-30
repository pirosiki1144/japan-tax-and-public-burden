import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { dependencyType, evaluateDependency, parseDependencies } from "./dependency-rules.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_OUTPUT = "reports/architecture-inventory.json";
const RESPONSIBILITY_PATH = "config/architecture-responsibilities.json";
const DERIVED = new Set(["docs/monitoring-extraction-target-review.md", "generated/public-burdens.csv", DEFAULT_OUTPUT]);
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

function trackedFiles(root) {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
    .trim().split("\n").filter((path) => path && existsSync(join(root, path))).sort();
}

export function classifyNonJavaScript(path) {
  if (DERIVED.has(path)) return "derived_artifact";
  if (path.startsWith("tests/fixtures/") || path.endsWith("/.gitkeep")) return "fixture";
  if (path.startsWith("docs/") || path === "README.md" || path === "PROJECT_SPEC.md" || path === "AGENTS.md") return "documentation";
  if (path.startsWith("schemas/") || path.startsWith("config/") || path.startsWith("data/")) return "source_of_truth";
  if (path.startsWith(".github/") || [".gitignore", "package.json", "package-lock.json"].includes(path)) return "repository_support";
  return "unclassified";
}

export function validateResponsibilityRegistry(registry, javascriptPaths) {
  const errors = [];
  if (registry?.schema_version !== 1 || !Array.isArray(registry.files)) return ["responsibility registry must have schema_version 1 and files"];
  const registered = new Map();
  const allowed = new Set(registry.responsibilities ?? []);
  for (const entry of registry.files) {
    if (!entry?.path || !entry?.responsibility) {
      errors.push("responsibility entry requires path and responsibility");
      continue;
    }
    if (registered.has(entry.path)) errors.push(`${entry.path}: duplicate responsibility registration`);
    if (!allowed.has(entry.responsibility)) errors.push(`${entry.path}: unknown responsibility ${entry.responsibility}`);
    registered.set(entry.path, entry.responsibility);
  }
  const actual = new Set(javascriptPaths);
  for (const path of javascriptPaths) if (!registered.has(path)) errors.push(`${path}: JavaScript responsibility is not registered`);
  for (const path of registered.keys()) if (!actual.has(path)) errors.push(`${path}: responsibility references a missing JavaScript file`);
  return errors.sort();
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
      cycles.push([...stack.slice(stack.indexOf(node)), node]);
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

async function json(root, path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
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

export async function analyzeJavaScriptDependencies(root, javascript, registry) {
  const fileSet = new Set(javascript);
  const responsibilities = new Map(registry.files.map(({ path, responsibility }) => [path, responsibility]));
  const adjacency = {};
  const edges = [];
  const violations = [];
  for (const sourcePath of javascript) {
    adjacency[sourcePath] = [];
    const source = await readFile(join(root, sourcePath), "utf8");
    for (const dependency of parseDependencies(source)) {
      const type = dependencyType(dependency.specifier, BUILTINS);
      const targetPath = type === "internal" ? resolveImport(sourcePath, dependency.specifier, fileSet) : null;
      const targetResponsibility = targetPath ? responsibilities.get(targetPath) : null;
      if (targetPath && !adjacency[sourcePath].includes(targetPath)) adjacency[sourcePath].push(targetPath);
      const edge = {
        source_path: sourcePath,
        source_responsibility: responsibilities.get(sourcePath),
        target_path: targetPath,
        target_responsibility: targetResponsibility,
        specifier: dependency.specifier,
        dependency_type: type,
        import_kind: dependency.import_kind
      };
      edges.push(edge);
      const violation = evaluateDependency({ ...edge, sourcePath, sourceResponsibility: edge.source_responsibility, targetPath, targetResponsibility, importKind: edge.import_kind, dependencyType: type });
      if (violation) violations.push(violation);
    }
    adjacency[sourcePath].sort();
  }
  return { adjacency, edges, violations, cycles: findCycles(adjacency) };
}

export async function buildArchitectureInventory(root = ROOT) {
  const files = trackedFiles(root);
  const javascript = files.filter((path) => extname(path) === ".js");
  const responsibilityRegistry = await json(root, RESPONSIBILITY_PATH);
  const registrationErrors = validateResponsibilityRegistry(responsibilityRegistry, javascript);
  const registered = new Map(responsibilityRegistry.files.map(({ path, responsibility }) => [path, responsibility]));
  const dependencies = await analyzeJavaScriptDependencies(root, javascript, responsibilityRegistry);
  const classified = files.map((path) => ({ path, responsibility: registered.get(path) ?? classifyNonJavaScript(path) }));
  const counts = Object.fromEntries([...new Set(classified.map(({ responsibility }) => responsibility))].sort()
    .map((responsibility) => [responsibility, classified.filter((entry) => entry.responsibility === responsibility).length]));
  const fsUsers = dependencies.edges.filter(({ specifier }) => ["node:fs", "node:fs/promises", "fs", "fs/promises"].includes(specifier)).map(({ source_path }) => source_path);
  const atomicWriters = javascript.filter((path) => path === "scripts/adapters/filesystem-store.js");
  return {
    schema_version: 2,
    scope: "tracked repository files",
    baseline_commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    responsibility_registry: { path: RESPONSIBILITY_PATH, errors: registrationErrors },
    totals: { tracked_files: files.length, javascript_files: javascript.length, import_edges: dependencies.edges.length },
    responsibilities: counts,
    files: classified,
    import_graph: { cycles: dependencies.cycles, violations: dependencies.violations, edges: dependencies.edges, adjacency: dependencies.adjacency },
    configuration_overlap: await configurationMetrics(root),
    io_duplication: { filesystem_importing_files: new Set(fsUsers).size, atomic_write_implementations: atomicWriters.length, filesystem_users: [...new Set(fsUsers)].sort(), atomic_writers: atomicWriters },
    change_surface: {
      current_automated_existing_target_manual_edits: ["config/sources.yaml", "config/monitoring.yaml"],
      current_derived_files_regenerated: ["docs/monitoring-extraction-target-review.md"],
      target_after_issue_71_manual_edits: ["config/sources.yaml", "config/monitoring.yaml"]
    }
  };
}

async function main() {
  const check = process.argv.includes("--check");
  const strict = process.argv.includes("--strict");
  const outputIndex = process.argv.indexOf("--output");
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : DEFAULT_OUTPUT;
  const report = await buildArchitectureInventory(ROOT);
  if (check) {
    const existing = JSON.parse(await readFile(join(ROOT, output), "utf8"));
    report.baseline_commit = existing.baseline_commit;
    if (`${JSON.stringify(report, null, 2)}\n` !== `${JSON.stringify(existing, null, 2)}\n`) throw new Error(`${output} is stale; run npm run architecture:audit`);
    if (report.responsibility_registry.errors.length) throw new Error(`responsibility registry errors: ${report.responsibility_registry.errors.join("; ")}`);
    if (report.import_graph.cycles.length) throw new Error(`circular imports are forbidden: ${report.import_graph.cycles.join("; ")}`);
    if (report.import_graph.violations.length) throw new Error(`architecture violations: ${JSON.stringify(report.import_graph.violations)}`);
    console.log(JSON.stringify({ status: "clean", files: report.totals.tracked_files, cycles: 0, violations: report.import_graph.violations.length, strict }));
    return;
  }
  await writeFile(join(ROOT, output), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: "written", output, files: report.totals.tracked_files, cycles: report.import_graph.cycles.length, violations: report.import_graph.violations.length }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
