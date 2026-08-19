import { createHash } from "node:crypto";

function topicKey(parts) {
  const identity = parts.map((part) => String(part ?? "unknown").trim().toLowerCase()).join("|");
  return `audit-${createHash("sha256").update(identity).digest("hex").slice(0, 20)}`;
}

function evidenceUrls(result) {
  return [...new Set([
    result.source_url,
    ...(result.fetches ?? []).map(({ source_url }) => source_url)
  ].filter(Boolean))];
}

function targetIdentity(difference) {
  const target = difference.target;
  return target ? `${target.record_id_field}:${target.record_id}:${target.path}` : difference.fact_id;
}

function finding({ code, sourceId, summary, details, urls, detectedAt, difference, taxId, topicIdentity }) {
  const target = difference?.target ?? null;
  return {
    severity: "needs_review",
    code,
    topic_key: topicKey([sourceId, code, topicIdentity ?? (difference ? targetIdentity(difference) : "source-level")]),
    source_id: sourceId,
    tax_id: target?.record_id_field === "tax_id" ? target.record_id : taxId ?? null,
    change_id: target?.record_id_field === "change_id" ? target.record_id : null,
    target,
    summary,
    details,
    source_urls: urls,
    detected_at: detectedAt
  };
}

export function auditSourceScan(scan) {
  if (scan?.schema_version !== 1 || !Array.isArray(scan.results)) throw new Error("Unsupported aggregate scan result");
  const detectedAt = scan.completed_at ?? new Date().toISOString();
  const findings = [];

  for (const result of scan.results) {
    const urls = evidenceUrls(result);
    if (result.status === "error") {
      findings.push(finding({
        code: result.error_code ?? "source_processing_failed",
        sourceId: result.source_id,
        summary: `${result.source_id} の自動確認に失敗`,
        details: result.error ?? "原因不明の取得・処理失敗",
        urls,
        detectedAt,
        taxId: result.tax_id
      }));
      continue;
    }
    const unmapped = (result.candidate_diff ?? []).filter(({ target }) => !target);
    if (unmapped.length) {
      findings.push(finding({
        code: "unmapped_official_change",
        sourceId: result.source_id,
        summary: `${result.source_id} で正本へ自動対応できない公式差分を検出`,
        details: unmapped.map((difference) => `${difference.fact_id}: ${JSON.stringify(difference.current)} → ${JSON.stringify(difference.candidate)}`).join("\n"),
        urls,
        detectedAt,
        taxId: result.tax_id,
        topicIdentity: "unmapped-semantic-values"
      }));
    }
  }

  const targetValues = new Map();
  for (const result of scan.results.filter(({ status }) => status === "change_detected")) {
    for (const difference of result.candidate_diff ?? []) {
      if (!difference.target) continue;
      const key = `${difference.target.file}:${difference.target.record_id}:${difference.target.path}`;
      const serialized = JSON.stringify(difference.candidate);
      if (targetValues.has(key) && targetValues.get(key).serialized !== serialized) {
        const previous = targetValues.get(key);
        findings.push(finding({
          code: "official_source_disagreement",
          sourceId: [previous.sourceId, result.source_id].sort().join("+"),
          summary: "公式ソース間で更新候補が一致しない",
          details: `${key}: ${previous.serialized} / ${serialized}`,
          urls: [...new Set([...previous.urls, ...evidenceUrls(result)])],
          detectedAt,
          difference
        }));
      } else {
        targetValues.set(key, { serialized, sourceId: result.source_id, urls: evidenceUrls(result) });
      }
    }
  }

  return {
    schema_version: 1,
    status: findings.length === 0 ? "clean" : "needs_review",
    generated_at: detectedAt,
    scan_status: scan.status,
    reproducibility: scan.results.flatMap((result) => (result.fetches ?? []).map(({ source_url, fetched_at, sha256 }) => ({ source_id: result.source_id, source_url, fetched_at, sha256 }))),
    summary: {
      sources_checked: scan.results.length,
      findings: findings.length,
      transient_failures: findings.filter(({ code }) => code === "url_transient_failure").length,
      structure_changes: findings.filter(({ code }) => code === "source_structure_changed").length,
      source_disagreements: findings.filter(({ code }) => code === "official_source_disagreement").length
    },
    findings
  };
}

export function issueCandidateForFinding(finding) {
  const marker = `[audit-topic:${finding.topic_key}]`;
  const safeText = (value) => String(value).replaceAll("@", "@\u200b").replaceAll("<!--", "&lt;!--");
  const urls = finding.source_urls.length > 0 ? finding.source_urls.map((url) => `- ${url}`).join("\n") : "- 取得前または取得中に失敗したため確認可能なURLなし";
  return {
    topic_key: finding.topic_key,
    marker,
    title: `[要確認] ${safeText(finding.summary)}`.slice(0, 200),
    body: `## 概要

自動監査が、推測によるデータ更新を禁止すべき事象を検出しました。正本データは変更していません。

## 監査結果

- 種別: \`${finding.code}\`
- source_id: \`${finding.source_id}\`
- tax_id: ${finding.tax_id ? `\`${finding.tax_id}\`` : "unknown"}
- change_id: ${finding.change_id ? `\`${finding.change_id}\`` : "unknown"}
- 検出日時: ${finding.detected_at}
- 詳細: ${safeText(finding.details)}

## 一次情報

${urls}

## 重複判定キー

${marker}

## 対応方針

- 一時障害の場合は再取得結果を追記する
- 構造変更またはソース不一致の場合は人間が公式情報を確認する
- 公式根拠が確定するまで正本を推測更新しない
- 成立・解決確認後もIssueを削除せず、根拠と関連PRを追記してCloseする

Related to #8
`
  };
}

export function issueCandidatesFromAudit(report) {
  return report.findings.map(issueCandidateForFinding);
}
