import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildInitialMasterSelection } from "../generate/initial-master-selection.js";
import { readYaml } from "../validate/schema-validator.js";
import { readText, writeTextAtomic } from "../adapters/filesystem-store.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputPath = join(root, "data/burdens/initial-master.json");

function lawId(url) {
  return url.match(/\/law_data\/([A-Z0-9]+)$/)?.[1] ?? null;
}

export async function buildInitialMasterBurdens(repositoryRoot) {
  const configuration = await readYaml(join(repositoryRoot, "config/initial-master-selection.yaml"));
  const candidates = new Map();
  for (const relativePath of configuration.candidate_files) {
    for (const candidate of await readYaml(join(repositoryRoot, relativePath))) candidates.set(candidate.candidate_id, candidate);
  }
  const selection = await buildInitialMasterSelection(repositoryRoot);
  return selection.records.filter(({ disposition }) => disposition === "insert").map((decision) => {
    const candidate = candidates.get(decision.candidate_id);
    const lawUrls = decision.source_urls.filter((url) => url.startsWith("https://laws.e-gov.go.jp/api/2/law_data/"));
    const legalBases = decision.law_titles.map((name, index) => ({
      law_id: lawId(lawUrls[index]),
      name,
      article: null,
      source_url: lawUrls[index]
    }));
    const evidenceGaps = [...new Set([
      ...candidate.evidence_gaps,
      "経済的負担者、目的、算定基礎を個別の公式資料で確認する",
      "公布日、施行日、適用開始日、徴収開始日を個別の公式資料で確認する"
    ])];
    return {
      tax_id: decision.proposed_tax_id,
      official_name: candidate.official_name,
      aliases: candidate.aliases,
      burden_type: candidate.burden_type,
      legal_mandate_type: candidate.legal_mandate_type,
      jurisdiction: candidate.jurisdiction,
      liable_party: candidate.liable_party,
      economic_bearer: "unknown",
      collectors: candidate.collectors,
      beneficiary_or_fund: null,
      purpose: "",
      calculation_basis: "",
      current_status: decision.current_status,
      legal_bases: legalBases,
      current_phases: [],
      pending_changes: [],
      source_refs: ["egov-laws"],
      coverage_status: candidate.coverage_status,
      evidence_gaps: evidenceGaps,
      verified_at: decision.verified_at
    };
  }).sort((left, right) => left.tax_id.localeCompare(right.tax_id, "en"));
}

async function run() {
  const check = process.argv.includes("--check");
  const content = `${JSON.stringify(await buildInitialMasterBurdens(root), null, 2)}\n`;
  if (check) {
    if (await readText(outputPath) !== content) throw new Error("data/burdens/initial-master.json differs from #28 selection");
    console.log(JSON.stringify({ status: "clean", burdens: JSON.parse(content).length }));
    return;
  }
  await writeTextAtomic(outputPath, content);
  console.log(JSON.stringify({ status: "generated", burdens: JSON.parse(content).length }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  run().catch((error) => {
    console.error(JSON.stringify({ status: "error", error: error.message }));
    process.exitCode = 1;
  });
}
