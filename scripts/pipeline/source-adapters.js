import { normalizeHtmlRegexFacts } from "../normalize/html-regex-facts.js";
import { normalizeEgovLawArticleFacts } from "../normalize/egov-law-article-facts.js";

const adapters = new Map([
  ["html_regex_facts", { normalize: normalizeHtmlRegexFacts }],
  ["egov_law_article_facts", { normalize: normalizeEgovLawArticleFacts }]
]);

export function getSourceAdapter(name) {
  const adapter = adapters.get(name);
  if (!adapter) throw new Error(`No implemented adapter: ${name}`);
  return adapter;
}
