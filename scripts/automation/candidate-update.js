import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseDocument } from "yaml";

function canonicalPath(root, relativePath) {
  const dataRoot = `${resolve(root, "data")}${sep}`;
  const path = resolve(root, relativePath);
  if (!path.startsWith(dataRoot)) throw new Error(`Candidate target must stay under data/: ${relativePath}`);
  return path;
}

function pathSegments(path) {
  return path.split(".").map((segment) => /^\d+$/.test(segment) ? Number(segment) : segment);
}

function selectRecord(document, target) {
  const visit = (value, prefix = []) => {
    if (value && typeof value === "object" && value[target.record_id_field] === target.record_id) return { record: value, prefix };
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const found = visit(value[index], [...prefix, index]);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        const found = visit(child, [...prefix, key]);
        if (found) return found;
      }
    }
    return null;
  };
  const found = visit(document);
  if (!found) throw new Error(`Candidate record not found: ${target.record_id}`);
  return found;
}

function readValue(record, segments, label) {
  let value = record;
  for (const segment of segments) {
    if (value === null || value === undefined || !Object.hasOwn(value, segment)) throw new Error(`Candidate path not found: ${label}`);
    value = value[segment];
  }
  return value;
}

function setValue(record, segments, value) {
  let parent = record;
  for (const segment of segments.slice(0, -1)) parent = parent[segment];
  parent[segments.at(-1)] = value;
}

function collectChanges(scan) {
  if (scan?.schema_version !== 1 || !Array.isArray(scan.results)) throw new Error("Unsupported aggregate scan result");
  if (scan.status === "error" || scan.results.some(({ status }) => status === "error")) throw new Error("Scan contains source errors; refusing candidate update");
  if (!scan.results.every(({ status }) => ["no_change", "change_detected"].includes(status))) throw new Error("Scan contains an unsupported source status");

  const changes = [];
  for (const result of scan.results.filter(({ status }) => status === "change_detected")) {
    if (!Array.isArray(result.fetches) || result.fetches.length === 0 || result.fetches.some(({ source_url, fetched_at, sha256 }) => !source_url || !fetched_at || !/^[a-f0-9]{64}$/.test(sha256 ?? ""))) {
      throw new Error(`Source evidence is incomplete: ${result.source_id}`);
    }
    for (const difference of result.candidate_diff ?? []) {
      if (!difference.target) throw new Error(`Candidate requires human review because it has no canonical target: ${result.source_id}/${difference.fact_id}`);
      changes.push({ ...difference, source_id: result.source_id, fetches: result.fetches });
    }
  }
  return changes;
}

export async function applyCandidateUpdates({ root, scan, writeText }) {
  if (typeof writeText !== "function") throw new Error("Atomic text writer is required");
  const changes = collectChanges(scan);
  const documents = new Map();
  const seenTargets = new Map();
  const applied = [];

  for (const change of changes) {
    const { target } = change;
    const key = `${target.file}:${target.record_id_field}:${target.record_id}:${target.path}`;
    if (seenTargets.has(key) && !isDeepStrictEqual(seenTargets.get(key), change.candidate)) throw new Error(`Conflicting candidates for ${key}`);
    seenTargets.set(key, change.candidate);

    const path = canonicalPath(root, target.file);
    if (!documents.has(path)) {
      const source = await readFile(path, "utf8");
      if (extname(path) === ".json") {
        documents.set(path, { format: "json", value: JSON.parse(source) });
      } else {
        const yaml = parseDocument(source);
        if (yaml.errors.length > 0) throw new Error(`${target.file}: ${yaml.errors[0].message}`);
        documents.set(path, { format: "yaml", yaml, value: yaml.toJS() });
      }
    }

    const document = documents.get(path);
    const { record, prefix } = selectRecord(document.value, target);
    const segments = pathSegments(target.path);
    const actual = readValue(record, segments, target.path);
    if (isDeepStrictEqual(actual, change.candidate)) continue;
    if (!isDeepStrictEqual(actual, change.current)) throw new Error(`Canonical value changed since scan: ${key}`);

    setValue(record, segments, change.candidate);
    if (document.format === "yaml") document.yaml.setIn([...prefix, ...segments], change.candidate);
    applied.push(change);
  }

  for (const [path, document] of documents) {
    const content = document.format === "json" ? `${JSON.stringify(document.value, null, 2)}\n` : document.yaml.toString();
    await writeText(path, content);
  }
  return { changes, applied };
}

function display(value) {
  return `\`${JSON.stringify(value)}\``;
}

export function buildPullRequestBody({ scan, changes }) {
  const sourceResults = scan.results.filter(({ status }) => status === "change_detected");
  const urls = [...new Set(sourceResults.flatMap(({ fetches }) => fetches.map(({ source_url }) => source_url)))];
  const checkedAt = [...new Set(sourceResults.flatMap(({ fetches }) => fetches.map(({ fetched_at }) => fetched_at)))];
  const files = [...new Set(changes.map(({ target }) => target.file))];
  const rows = changes.map((change) => `| ${change.source_id} / ${change.fact_id} | \`${change.target.file}\` / \`${change.target.record_id}\` / \`${change.target.path}\` | ${display(change.current)} | ${display(change.candidate)} |`).join("\n");
  return `## 概要

公式一次情報の自動取得で検出した確定的な差分を、正本データの更新候補として提出します。自動マージは行いません。

## 関連Issue

Related to #9

## 根拠

${urls.map((url) => `- 公式URL: ${url}`).join("\n")}
${checkedAt.map((time) => `- 取得・確認日時: ${time}`).join("\n")}

## 変更内容

| 出典 / 事実 | 対象 | 旧値 | 新値 |
| --- | --- | --- | --- |
${rows}

## 影響範囲

${files.map((file) => `- \`${file}\``).join("\n")}

## 検証結果

- \`npm test\`
- \`npm run validate\`
- 取得失敗、構造変更、対象不明、競合がないことを確認

## 未解決・不確実な点

なし。対象を一意に特定できない差分はこのPRへ含めず、安全停止します。

## 確認事項

- [x] 送信先は \`main\` である
- [x] \`main\` へ直接pushしていない
- [x] 公式URL、取得日時、旧値、新値を記録した
- [x] 自動マージを設定していない
- [ ] 人間が内容をレビューし、マージ可否を判断する
`;
}

export async function writePullRequestBody(path, body, writeText) {
  if (typeof writeText !== "function") throw new Error("Atomic text writer is required");
  await writeText(path, body);
}
