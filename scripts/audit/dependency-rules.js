const INTERNAL_FORBIDDEN = {
  domain: new Set(["application", "adapter", "cli", "composition_root"]),
  application: new Set(["adapter", "cli", "composition_root"]),
  adapter: new Set(["application", "adapter", "cli", "composition_root"])
};

function addMatches(source, regex, importKind, dependencies) {
  for (const match of source.matchAll(regex)) dependencies.push({ specifier: match[1], import_kind: importKind });
}

export function parseDependencies(source) {
  const dependencies = [];
  addMatches(source, /\bimport\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g, "static_import", dependencies);
  addMatches(source, /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g, "re_export", dependencies);
  addMatches(source, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, "dynamic_import", dependencies);
  addMatches(source, /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, "commonjs_require", dependencies);
  return dependencies;
}

export function dependencyType(specifier, builtinNames = new Set()) {
  if (specifier.startsWith(".")) return "internal";
  if (specifier.startsWith("node:") || builtinNames.has(specifier)) return "node_builtin";
  return "external_package";
}

export function evaluateDependency({ sourcePath, sourceResponsibility, targetPath = null, targetResponsibility = null, specifier, importKind, dependencyType: type }) {
  let rule = null;
  if (importKind === "commonjs_require") rule = "commonjs_require_forbidden";
  else if (type === "internal" && INTERNAL_FORBIDDEN[sourceResponsibility]?.has(targetResponsibility)) rule = "responsibility_direction_forbidden";
  else if (sourceResponsibility === "domain" && type === "node_builtin") rule = "domain_node_builtin_forbidden";
  else if (sourceResponsibility === "domain" && type === "external_package") rule = "domain_external_package_forbidden";
  if (!rule) return null;
  return {
    source_path: sourcePath,
    source_responsibility: sourceResponsibility,
    target_path: targetPath,
    target_responsibility: targetResponsibility,
    specifier,
    dependency_type: type,
    import_kind: importKind,
    rule
  };
}

export function violationKey(violation) {
  return [violation.source_path, violation.source_responsibility, violation.target_path ?? violation.specifier, violation.target_responsibility ?? violation.dependency_type, violation.import_kind, violation.rule].join("|");
}

export function compareViolations(violations, baseline) {
  const group = (items) => items.reduce((map, item) => {
    const key = violationKey(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
    return map;
  }, new Map());
  const current = group(violations);
  const expected = group(baseline);
  return {
    new_violations: [...current].flatMap(([key, items]) => items.slice(expected.get(key)?.length ?? 0)),
    resolved_without_baseline_update: [...expected].flatMap(([key, items]) => items.slice(current.get(key)?.length ?? 0))
  };
}
