function requireFunction(value, label) {
  if (typeof value !== "function") throw new TypeError(`${label} must be a function`);
}

export function createStrategyRegistry(kind, validateResult) {
  requireFunction(validateResult, `${kind} result contract`);
  const strategies = new Map();
  return Object.freeze({
    register(name, strategy) {
      if (typeof name !== "string" || name.length === 0) throw new TypeError(`${kind} name is required`);
      requireFunction(strategy, `${kind} ${name}`);
      if (strategies.has(name)) throw new Error(`Duplicate ${kind}: ${name}`);
      strategies.set(name, strategy);
      return this;
    },
    has: (name) => strategies.has(name),
    names: () => [...strategies.keys()].sort(),
    get(name) {
      const strategy = strategies.get(name);
      if (!strategy) throw new Error(`No registered ${kind}: ${name}`);
      return async (...args) => {
        const result = await strategy(...args);
        validateResult(result, name);
        return result;
      };
    }
  });
}

export function validateSourcePages(pages, name) {
  if (!Array.isArray(pages) || pages.length === 0) throw new TypeError(`${name} must return one or more source pages`);
  for (const page of pages) {
    if (!page || typeof page !== "object" || !page.source_url || !page.sha256 || (!page.bytes && typeof page.body !== "string")) throw new TypeError(`${name} returned an invalid source page`);
  }
}

export function validateDocument(document, name) {
  if (!document || typeof document !== "object" || !document.format || !document.evidence?.source_url) throw new TypeError(`${name} returned an invalid official document`);
}

export function validateNormalizedFacts(normalized, name) {
  if (!normalized || typeof normalized !== "object" || !normalized.source_id || !Array.isArray(normalized.facts)) throw new TypeError(`${name} returned invalid normalized facts`);
}

export function validateSemanticExtraction(extracted, name) {
  if (!extracted || typeof extracted !== "object" || !extracted.record || !Array.isArray(extracted.fetches)) throw new TypeError(`${name} returned an invalid semantic extraction`);
}

export function validatePorts(ports) {
  for (const [name, method] of [
    ["sourceRepository.loadEnabled", ports?.sourceRepository?.loadEnabled],
    ["sourceRepository.loadAutomated", ports?.sourceRepository?.loadAutomated],
    ["sourceReader.read", ports?.sourceReader?.read],
    ["canonicalRepository.diff", ports?.canonicalRepository?.diff]
  ]) requireFunction(method, name);
  if (typeof ports.sourceNormalizers?.get !== "function") throw new TypeError("sourceNormalizers registry is required");
  return ports;
}
