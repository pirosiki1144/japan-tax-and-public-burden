import { normalizeHtmlRegexFacts } from "../normalize/html-regex-facts.js";

const adapters = new Map([
  ["html_regex_facts", { normalize: normalizeHtmlRegexFacts }]
]);

export function getSourceAdapter(name) {
  const adapter = adapters.get(name);
  if (!adapter) throw new Error(`No implemented adapter: ${name}`);
  return adapter;
}
