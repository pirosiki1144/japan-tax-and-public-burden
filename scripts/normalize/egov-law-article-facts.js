function flattenText(node) {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  return (node.children ?? []).map(flattenText).join("");
}

function collectArticles(node, articles = []) {
  if (!node || typeof node !== "object") return articles;
  if (node.tag === "Article") articles.push(node);
  for (const child of node.children ?? []) collectArticles(child, articles);
  return articles;
}

function collectTagged(node, tag, matches = []) {
  if (!node || typeof node !== "object") return matches;
  if (node.tag === tag) matches.push(node);
  for (const child of node.children ?? []) collectTagged(child, tag, matches);
  return matches;
}

function articleCaption(article) {
  return flattenText((article.children ?? []).find(({ tag }) => tag === "ArticleCaption"));
}

function compile(pattern, factId) {
  try {
    return new RegExp(pattern);
  } catch (error) {
    throw new Error(`Invalid extraction pattern for ${factId}: ${error.message}`);
  }
}

export function normalizeEgovLawArticleFacts(source, pages) {
  const extraction = source.extraction;
  if (pages.length !== extraction.expected_pages) {
    throw new Error(`Source structure changed: expected ${extraction.expected_pages} configured pages but found ${pages.length}`);
  }
  const documents = pages.map(({ body }, index) => {
    try {
      return JSON.parse(body);
    } catch (error) {
      throw new Error(`Source structure changed: page ${index} is not valid JSON: ${error.message}`);
    }
  });
  for (const expected of extraction.expected_documents ?? []) {
    const document = documents[expected.page_index];
    if (document?.law_info?.law_id !== expected.law_id || document?.revision_info?.law_title !== expected.law_title) {
      throw new Error(`Source structure changed: expected law ${expected.law_id} (${expected.law_title}) on page ${expected.page_index}`);
    }
  }
  const facts = extraction.facts.map((fact) => {
    const document = documents[fact.page_index];
    const matches = collectArticles(document?.law_full_text).filter((article) =>
      article.attr?.Num === fact.article_num && articleCaption(article) === fact.article_caption
    );
    if (matches.length !== 1) throw new Error(`Source structure changed: ${fact.fact_id} matched ${matches.length} articles`);
    let extractionNode = matches[0];
    if (fact.item_num) {
      const items = collectTagged(extractionNode, "Item").filter((item) => item.attr?.Num === fact.item_num);
      if (items.length !== 1) throw new Error(`Source structure changed: ${fact.fact_id} matched ${items.length} items`);
      extractionNode = items[0];
    }
    const match = flattenText(extractionNode).match(compile(fact.pattern, fact.fact_id));
    const raw = match?.[fact.capture_group];
    if (raw === undefined) throw new Error(`Source structure changed: ${fact.fact_id} was not found`);
    return { fact_id: fact.fact_id, raw, value: raw, expected_value: fact.expected_value, target: fact.target };
  });
  return { source_id: source.source_id, facts };
}
