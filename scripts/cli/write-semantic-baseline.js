import { buildSemanticBaseline } from "../composition/semantic-baseline.js";
import { readJson, writeJsonAtomic } from "../adapters/filesystem-store.js";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const input = option("input");
const output = option("output");
const confirmed = args.includes("--confirm-reviewed");

if (!input || !output || !confirmed) {
  console.error("Usage: node scripts/monitoring/write-semantic-baseline.js --input <reviewed-run.json> --output <review.json> --confirm-reviewed");
  process.exitCode = 2;
} else {
  try {
    const baseline = buildSemanticBaseline(await readJson(input));
    await writeJsonAtomic(output, { schema_version: 1, reviewed_at: baseline.reviewed_at, baseline });
    console.log(JSON.stringify({ status: "written", records: baseline.records.length, reviewed_at: baseline.reviewed_at }));
  } catch (error) {
    console.error(JSON.stringify({ status: "error", error: error.message }));
    process.exitCode = 1;
  }
}
