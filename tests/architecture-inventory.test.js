import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildArchitectureInventory, classifyNonJavaScript, validateResponsibilityRegistry, validateViolationBaseline } from "../scripts/audit/architecture-inventory.js";
import { compareViolations, dependencyType, evaluateDependency, parseDependencies } from "../scripts/audit/dependency-rules.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function internal(sourceResponsibility, targetResponsibility, sourcePath = "any/source.js", targetPath = "any/target.js") {
  return evaluateDependency({ sourcePath, sourceResponsibility, targetPath, targetResponsibility, specifier: "./target.js", importKind: "static_import", dependencyType: "internal" });
}

test("every JavaScript file has exactly one explicit path-independent responsibility", async () => {
  const report = await buildArchitectureInventory(root);
  assert.deepEqual(report.responsibility_registry.errors, []);
  assert.equal(report.files.some(({ responsibility }) => responsibility === "unclassified"), false);
  assert.equal(report.files.length, report.totals.tracked_files);
  assert.equal(report.responsibility_registry.path, "config/architecture-responsibilities.json");
});

test("unregistered, duplicate, and missing JavaScript registrations fail", () => {
  const registry = (files) => ({ schema_version: 1, responsibilities: ["domain", "adapter"], files });
  assert.deepEqual(validateResponsibilityRegistry(registry([{ path: "a.js", responsibility: "domain" }]), ["a.js"]), []);
  assert.ok(validateResponsibilityRegistry(registry([]), ["a.js"])[0].includes("not registered"));
  assert.ok(validateResponsibilityRegistry(registry([{ path: "gone.js", responsibility: "domain" }]), [])[0].includes("missing"));
  assert.ok(validateResponsibilityRegistry(registry([{ path: "a.js", responsibility: "domain" }, { path: "a.js", responsibility: "adapter" }]), ["a.js"])[0].includes("duplicate"));
  assert.ok(validateResponsibilityRegistry(registry([{ path: "a.js", responsibility: "new_layer" }]), ["a.js"])[0].includes("unknown responsibility"));
});

test("static imports, re-exports, dynamic imports, and CommonJS require are classified", () => {
  const commonJsKeyword = ["requ", "ire"].join("");
  assert.deepEqual(parseDependencies(`
    import value from "./static.js";
    export { value } from "./exported.js";
    const lazy = import("external-package");
    const legacy = ${commonJsKeyword}("node:fs");
  `), [
    { specifier: "./static.js", import_kind: "static_import" },
    { specifier: "./exported.js", import_kind: "re_export" },
    { specifier: "external-package", import_kind: "dynamic_import" },
    { specifier: "node:fs", import_kind: "commonjs_require" }
  ]);
  assert.equal(dependencyType("node:path"), "node_builtin");
  assert.equal(dependencyType("ajv"), "external_package");
  assert.equal(dependencyType("../domain.js"), "internal");
});

test("domain, application, and adapter forbidden directions use responsibilities", () => {
  for (const target of ["application", "adapter", "cli", "composition_root"]) assert.equal(internal("domain", target).rule, "responsibility_direction_forbidden");
  for (const target of ["adapter", "cli", "composition_root"]) assert.equal(internal("application", target).rule, "responsibility_direction_forbidden");
  for (const target of ["application", "adapter", "cli", "composition_root"]) assert.equal(internal("adapter", target).rule, "responsibility_direction_forbidden");
  assert.equal(internal("application", "domain"), null);
  assert.equal(internal("adapter", "domain"), null);
});

test("domain cannot import Node.js builtins or external packages and require is always forbidden", () => {
  assert.equal(evaluateDependency({ sourcePath: "domain.js", sourceResponsibility: "domain", specifier: "node:fs", importKind: "static_import", dependencyType: "node_builtin" }).rule, "domain_node_builtin_forbidden");
  assert.equal(evaluateDependency({ sourcePath: "domain.js", sourceResponsibility: "domain", specifier: "yaml", importKind: "dynamic_import", dependencyType: "external_package" }).rule, "domain_external_package_forbidden");
  assert.equal(evaluateDependency({ sourcePath: "cli.js", sourceResponsibility: "cli", specifier: "x", importKind: "commonjs_require", dependencyType: "external_package" }).rule, "commonjs_require_forbidden");
});

test("CLI and composition roots may assemble inward and outward dependencies", () => {
  for (const source of ["cli", "composition_root"]) for (const target of ["domain", "application", "adapter", "cli", "composition_root"]) assert.equal(internal(source, target), null);
});

test("moving a file without changing its explicit responsibility does not change the verdict", () => {
  const before = internal("domain", "adapter", "scripts/old/place.js", "scripts/adapter.js");
  const after = internal("domain", "adapter", "src/new/place.js", "src/adapter.js");
  assert.equal(before.rule, after.rule);
  assert.equal(before.source_responsibility, after.source_responsibility);
});

test("diagnostics include paths, responsibilities, dependency type, and import kind", () => {
  const violation = internal("application", "adapter");
  assert.deepEqual(Object.keys(violation).sort(), ["dependency_type", "import_kind", "rule", "source_path", "source_responsibility", "specifier", "target_path", "target_responsibility"].sort());
});

test("the migration baseline exposes every current violation and rejects drift", async () => {
  const report = await buildArchitectureInventory(root);
  assert.equal(report.import_graph.violations.length, 22);
  assert.equal(report.import_graph.violations.filter(({ rule }) => rule === "responsibility_direction_forbidden").length, 14);
  const builtinViolations = report.import_graph.violations.filter(({ rule }) => rule === "domain_node_builtin_forbidden");
  assert.equal(builtinViolations.length, 8);
  assert.equal(new Set(builtinViolations.map(({ source_path }) => source_path)).size, 6);
  assert.equal(report.violation_baseline.issue, 93);
  assert.equal(report.violation_baseline.entries, 22);
  assert.deepEqual(report.violation_baseline.errors, []);
  assert.deepEqual(report.violation_baseline.new_violations, []);
  assert.deepEqual(report.violation_baseline.resolved_without_baseline_update, []);
  assert.ok(report.import_graph.violations.every((item) => item.source_path && item.source_responsibility && item.dependency_type && item.import_kind));
  assert.deepEqual(report.import_graph.cycles, []);
  const comparison = compareViolations([...report.import_graph.violations, { ...report.import_graph.violations[0], source_path: "new.js" }], report.import_graph.violations);
  assert.equal(comparison.new_violations.length, 1);
  assert.equal(compareViolations([...report.import_graph.violations, report.import_graph.violations[0]], report.import_graph.violations).new_violations.length, 1);
  assert.deepEqual(validateViolationBaseline({ schema_version: 1, remediation_issue: 93, violations: report.import_graph.violations.map((item) => ({ ...item, remediation_issue: 93 })) }), []);
});

test("non-JavaScript classification remains separate from the responsibility registry", () => {
  assert.equal(classifyNonJavaScript("config/sources.yaml"), "source_of_truth");
  assert.equal(classifyNonJavaScript("tests/fixtures/source-scan/example.html"), "fixture");
});
