import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildSemanticBaseline } from "./semantic-baseline.js";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const input = option("input");
const output = option("output");
const confirmed = args.includes("--confirm-reviewed");

if (!input || !output || !confirmed) {
  console.error("Usage: node scripts/monitoring/write-semantic-baseline.js --input <reviewed-run.json> --output <baseline.json> --confirm-reviewed");
  process.exitCode = 2;
} else {
  try {
    const baseline = buildSemanticBaseline(JSON.parse(await readFile(input, "utf8")));
    await mkdir(dirname(output), { recursive: true });
    const temporary = `${output}.tmp`;
    await writeFile(temporary, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
    await rename(temporary, output);
    console.log(JSON.stringify({ status: "written", records: baseline.records.length, reviewed_at: baseline.reviewed_at }));
  } catch (error) {
    console.error(JSON.stringify({ status: "error", error: error.message }));
    process.exitCode = 1;
  }
}
