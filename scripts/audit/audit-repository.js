import { fileURLToPath } from "node:url";
import { auditRepository } from "../application/repository-operations.js";
import { writeJsonAtomic } from "../adapters/filesystem-store.js";
import { validateRepository } from "../validate/repository-validator.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const output = option("output");
const asOf = option("as-of") ?? new Date().toISOString().slice(0, 10);

try {
  const report = await auditRepository({ root, asOf, now: () => new Date(), validateRepository });
  if (output) await writeJsonAtomic(output, report);
  console.log(JSON.stringify(report));
  if (report.status === "error") process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ status: "error", error: error.message }));
  process.exitCode = 1;
}
