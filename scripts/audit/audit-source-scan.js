import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { auditSourceScan, issueCandidatesFromAudit } from "./source-scan-audit.js";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const scanPath = option("scan");
const reportPath = option("report");

if (!scanPath || !reportPath) {
  console.error("Usage: node scripts/audit/audit-source-scan.js --scan <scan.json> --report <audit.json>");
  process.exitCode = 2;
} else {
  try {
    const scan = JSON.parse(await readFile(scanPath, "utf8"));
    const report = auditSourceScan(scan);
    report.issue_candidates = issueCandidatesFromAudit(report);
    await mkdir(dirname(reportPath), { recursive: true });
    const temporary = `${reportPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await rename(temporary, reportPath);
    console.log(JSON.stringify({ status: report.status, findings: report.findings.length }));
  } catch (error) {
    console.error(JSON.stringify({ status: "error", error: error.message }));
    process.exitCode = 1;
  }
}
