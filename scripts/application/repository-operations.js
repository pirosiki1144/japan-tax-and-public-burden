import { auditRepositoryCollections } from "../audit/repository-audit.js";
import { auditSourceScan, issueCandidatesFromAudit } from "../audit/source-scan-audit.js";
import { compareArtifactSets } from "../generate/distribution-generator.js";

export async function validateData({ root, file, schema, validateRepository, validateFile }) {
  if (!file && !schema) return validateRepository(root);
  if (!file || !schema) return { errors: ["Both --file and --schema are required."] };
  try {
    return { errors: await validateFile(root, file, schema) };
  } catch (error) {
    return { errors: [`${file}: ${error.message}`] };
  }
}

export async function auditRepository({ root, asOf, now, validateRepository }) {
  const { errors, collections } = await validateRepository(root);
  const findings = [...errors.map((message) => ({ severity: "error", code: "schema_or_integrity_error", record_id: null, message })), ...auditRepositoryCollections(collections, { asOf })];
  return { schema_version: 1, status: findings.some(({ severity }) => severity === "error") ? "error" : findings.length ? "warning" : "clean", generated_at: now().toISOString(), as_of: asOf, summary: { errors: findings.filter(({ severity }) => severity === "error").length, warnings: findings.filter(({ severity }) => severity === "warning").length }, findings };
}

export function auditScan(scan) {
  const report = auditSourceScan(scan);
  report.issue_candidates = issueCandidatesFromAudit(report);
  return report;
}

export async function generateDistribution({ root, asOf, outputDirectory, check, buildArtifacts, fileStore }) {
  const artifacts = await buildArtifacts(root, { asOf });
  if (check) {
    const existing = await fileStore.listFileNames(outputDirectory);
    const differences = compareArtifactSets(artifacts, await fileStore.readNamedTexts(outputDirectory, existing));
    if (differences.length) throw new Error(`Generated artifacts differ:\n${differences.join("\n")}`);
    return { status: "clean", files: artifacts.size };
  }
  await fileStore.writeNamedTexts(outputDirectory, artifacts);
  return { status: "generated", files: artifacts.size };
}

export function scanSources(options) {
  return options.scanAll ? options.runAll(options) : options.runOne(options);
}

export function monitorSources(options) {
  return options.run(options);
}
