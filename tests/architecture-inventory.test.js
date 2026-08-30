import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildArchitectureInventory, classifyNonJavaScript, validateResponsibilityRegistry } from "../scripts/cli/architecture-inventory.js";
import { dependencyType, evaluateDependency, parseDependencies } from "../scripts/domain/dependency-rules.js";

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

test("strict architecture inspection has no violations or cycles", async () => {
  const report = await buildArchitectureInventory(root);
  assert.deepEqual(report.import_graph.violations, []);
  assert.deepEqual(report.import_graph.cycles, []);
});

test("script placement matches the five physical directories without changing responsibilities", async () => {
  const report = await buildArchitectureInventory(root);
  const directoryByResponsibility = { cli: "cli", application: "application", domain: "domain", adapter: "adapters", composition_root: "composition" };
  const scriptFiles = report.files.filter(({ path }) => path.startsWith("scripts/") && path.endsWith(".js"));
  assert.deepEqual([...new Set(scriptFiles.map(({ path }) => path.split("/")[1]))].sort(), ["adapters", "application", "cli", "composition", "domain"]);
  for (const { path, responsibility } of scriptFiles) assert.equal(path.split("/")[1], directoryByResponsibility[responsibility], path);
});

test("non-JavaScript classification remains separate from the responsibility registry", () => {
  assert.equal(classifyNonJavaScript("config/sources.yaml"), "source_of_truth");
  assert.equal(classifyNonJavaScript("tests/fixtures/source-scan/example.html"), "fixture");
});
