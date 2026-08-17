import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRepository } from "../validate/repository-validator.js";
import { auditRepositoryCollections } from "./repository-audit.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const output = option("output");
const asOf = option("as-of") ?? new Date().toISOString().slice(0, 10);

try {
  const { errors, collections } = await validateRepository(root);
  const findings = [
    ...errors.map((message) => ({ severity: "error", code: "schema_or_integrity_error", record_id: null, message })),
    ...auditRepositoryCollections(collections, { asOf })
  ];
  const report = {
    schema_version: 1,
    status: findings.some(({ severity }) => severity === "error") ? "error" : findings.length > 0 ? "warning" : "clean",
    generated_at: new Date().toISOString(),
    as_of: asOf,
    summary: { errors: findings.filter(({ severity }) => severity === "error").length, warnings: findings.filter(({ severity }) => severity === "warning").length },
    findings
  };
  if (output) {
    await mkdir(dirname(output), { recursive: true });
    const temporary = `${output}.tmp`;
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await rename(temporary, output);
  }
  console.log(JSON.stringify(report));
  if (report.status === "error") process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ status: "error", error: error.message }));
  process.exitCode = 1;
}
