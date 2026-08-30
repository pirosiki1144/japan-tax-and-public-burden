import { sha256 as hashText } from "./sha256.js";

function atPointer(document, pointer) {
  return pointer.split("/").slice(1).reduce((value, segment) => value?.[segment.replaceAll("~1", "/").replaceAll("~0", "~")], document);
}

function collectMatchingNodes(node, selector, matches = []) {
  if (!node || typeof node !== "object") return matches;
  if (node.tag === selector.tag && selector.values.includes(node.attr?.[selector.attribute])) matches.push(node);
  for (const child of node.children ?? []) collectMatchingNodes(child, selector, matches);
  return matches;
}

function collectTaggedNodes(node, tag, matches = []) {
  if (!node || typeof node !== "object") return matches;
  if (node.tag === tag) matches.push(node);
  for (const child of node.children ?? []) collectTaggedNodes(child, tag, matches);
  return matches;
}

function sha256(value) {
  return hashText(JSON.stringify(value));
}

export function buildEgovChangeSnapshot(document, source) {
  if (source.change_detection?.document_format !== "egov_law_api_v2_json") throw new Error("e-Gov change detection configuration is missing");
  const revisionId = atPointer(document, source.change_detection.revision_id_path);
  const updatedAt = atPointer(document, source.change_detection.updated_at_path);
  if (!revisionId || !updatedAt) throw new Error("e-Gov revision metadata is missing");
  const targets = source.extraction_targets.map((target) => {
    if (typeof target === "string") throw new Error("e-Gov extraction target must be structured");
    const root = atPointer(document, target.selector.root_path);
    const scopes = collectTaggedNodes(root, target.selector.scope_tag);
    if (scopes.length !== 1) throw new Error(`${target.target_id}: expected one ${target.selector.scope_tag} but found ${scopes.length}`);
    const nodes = collectMatchingNodes(scopes[0], target.selector);
    if (nodes.length !== target.selector.values.length) throw new Error(`${target.target_id}: expected ${target.selector.values.length} nodes but found ${nodes.length}`);
    return { target_id: target.target_id, content_sha256: sha256(nodes) };
  });
  return { revision_id: revisionId, updated_at: updatedAt, targets };
}

export function hasEgovSourceChanged(previous, current) {
  return previous.revision_id !== current.revision_id || previous.targets.some((target, index) => target.content_sha256 !== current.targets[index]?.content_sha256);
}
