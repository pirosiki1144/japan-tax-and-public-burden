import { auditScan } from "../application/repository-operations.js";
import { readJson, writeJsonAtomic } from "../adapters/filesystem-store.js";

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
    const report = auditScan(await readJson(scanPath));
    await writeJsonAtomic(reportPath, report);
    console.log(JSON.stringify({ status: report.status, findings: report.findings.length }));
  } catch (error) {
    console.error(JSON.stringify({ status: "error", error: error.message }));
    process.exitCode = 1;
  }
}
