import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { applyCandidateUpdates, buildPullRequestBody, writePullRequestBody } from "./candidate-update.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const scanPath = option("scan");
const reportPath = option("report");

if (!scanPath || !reportPath) {
  console.error("Usage: node scripts/automation/prepare-update.js --scan <result.json> --report <pr-body.md>");
  process.exitCode = 2;
} else {
  try {
    const scan = JSON.parse(await readFile(scanPath, "utf8"));
    const { changes, applied } = await applyCandidateUpdates({ root, scan });
    await writePullRequestBody(reportPath, buildPullRequestBody({ scan, changes }));
    console.log(JSON.stringify({ status: changes.length === 0 ? "no_change" : "prepared", detected: changes.length, applied: applied.length }));
  } catch (error) {
    console.error(JSON.stringify({ status: "error", error: error.message }));
    process.exitCode = 1;
  }
}
