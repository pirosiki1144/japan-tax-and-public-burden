import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createValidators, readYaml, validateDocument } from "./schema-validator.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const errors = [];
const schemaNames = ["burden", "change", "event", "phase", "source"];
const schemaPaths = Object.fromEntries(schemaNames.map((name) => [name, join(root, `schemas/${name}.schema.json`)]));
const validators = await createValidators(schemaPaths);

async function validateFile(path, validator, allowArray = true) {
  try {
    const parsed = await readYaml(path);
    const documents = allowArray && Array.isArray(parsed) ? parsed : [parsed];
    documents.forEach((document, index) => {
      const location = documents.length === 1 ? path : `${path}[${index}]`;
      errors.push(...validateDocument(validator, document, location));
    });
  } catch (error) {
    errors.push(`${path}: ${error.message}`);
  }
}

const argumentsMap = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));

if (argumentsMap.file || argumentsMap.schema) {
  if (!argumentsMap.file || !validators[argumentsMap.schema]) {
    errors.push("Both --file and a valid --schema (burden, change, event, phase, source) are required.");
  } else {
    await validateFile(argumentsMap.file, validators[argumentsMap.schema], argumentsMap.schema !== "source");
  }
} else {
  await validateFile(join(root, "config/sources.yaml"), validators.source, false);

  for (const [directory, schemaName] of Object.entries({ burdens: "burden", changes: "change", events: "event", phases: "phase" })) {
    const path = join(root, "data", directory);
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isFile() && [".json", ".yaml", ".yml"].includes(extname(entry.name))) {
        await validateFile(join(path, entry.name), validators[schemaName]);
      }
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("All configuration and data files conform to their JSON Schemas.");
}
