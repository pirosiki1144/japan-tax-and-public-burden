import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readYaml } from "../validate/schema-validator.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputPath = join(root, "reports/initial-master-selection.json");

function assertUnique(records, field) {
  const values = records.map((record) => record[field]);
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${field}`);
}

export async function buildInitialMasterSelection(repositoryRoot) {
  const configuration = await readYaml(join(repositoryRoot, "config/initial-master-selection.yaml"));
  const candidates = [];
  for (const relativePath of configuration.candidate_files) {
    const records = await readYaml(join(repositoryRoot, relativePath));
    candidates.push(...records.map((record) => ({ ...record, candidate_file: relativePath })));
  }
  assertUnique(candidates, "candidate_id");

  const burdenIds = new Set();
  for (const entry of await readdir(join(repositoryRoot, "data/burdens"), { withFileTypes: true })) {
    if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
    const burden = await readYaml(join(repositoryRoot, "data/burdens", entry.name));
    for (const record of Array.isArray(burden) ? burden : [burden]) burdenIds.add(record.tax_id);
  }

  const merges = new Map(configuration.existing_merges.map((decision) => [decision.candidate_id, decision]));
  for (const decision of merges.values()) {
    if (!candidates.some(({ candidate_id }) => candidate_id === decision.candidate_id)) throw new Error(`Unknown merge candidate ${decision.candidate_id}`);
    if (!burdenIds.has(decision.existing_tax_id)) throw new Error(`Unknown existing tax_id ${decision.existing_tax_id}`);
  }
  for (const review of configuration.identity_reviews) {
    for (const id of review.candidate_ids) if (!candidates.some(({ candidate_id }) => candidate_id === id)) throw new Error(`Unknown identity-review candidate ${id}`);
  }

  const records = candidates.map((candidate) => {
    const merge = merges.get(candidate.candidate_id);
    const disposition = merge ? "merge_existing" : configuration.default_decision.disposition;
    return {
      candidate_id: candidate.candidate_id,
      candidate_file: candidate.candidate_file,
      proposed_tax_id: merge?.existing_tax_id ?? candidate.candidate_id,
      disposition,
      existing_tax_id: merge?.existing_tax_id ?? null,
      identity_basis: merge?.reason ?? "候補間の名称完全一致はなく、候補IDを永続ID案として維持する",
      burden_type: candidate.burden_type,
      coverage_status: candidate.coverage_status,
      current_status: candidate.current_status,
      evidence_gaps: candidate.evidence_gaps,
      source_urls: candidate.source_urls,
      verified_at: candidate.verified_at,
      decision_reason: merge?.reason ?? configuration.default_decision.reason
    };
  }).sort((left, right) => left.candidate_id.localeCompare(right.candidate_id, "en"));

  const proposedNewIds = records.filter(({ disposition }) => disposition !== "merge_existing");
  assertUnique(proposedNewIds, "proposed_tax_id");
  for (const record of proposedNewIds) if (burdenIds.has(record.proposed_tax_id)) throw new Error(`Proposed tax_id already exists: ${record.proposed_tax_id}`);

  const count = (disposition) => records.filter((record) => record.disposition === disposition).length;
  return {
    schema_version: configuration.schema_version,
    dataset: "initial-master-selection",
    issue: configuration.issue,
    decided_at: configuration.decided_at,
    completeness_note: "収集済み候補119件に対する判定であり、日本の公的負担の完全一覧ではない",
    counts: {
      candidates: records.length,
      insert: count("insert"),
      merge_existing: count("merge_existing"),
      hold: count("hold"),
      excluded: count("excluded")
    },
    identity_reviews: configuration.identity_reviews,
    records
  };
}

async function run() {
  const check = process.argv.includes("--check");
  const report = `${JSON.stringify(await buildInitialMasterSelection(root), null, 2)}\n`;
  if (check) {
    if (await readFile(outputPath, "utf8") !== report) throw new Error("reports/initial-master-selection.json differs from candidate decisions");
    console.log(JSON.stringify({ status: "clean", candidates: JSON.parse(report).counts.candidates }));
    return;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp`;
  await writeFile(temporary, report, "utf8");
  await rename(temporary, outputPath);
  console.log(JSON.stringify({ status: "generated", candidates: JSON.parse(report).counts.candidates }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  run().catch((error) => {
    console.error(JSON.stringify({ status: "error", error: error.message }));
    process.exitCode = 1;
  });
}
