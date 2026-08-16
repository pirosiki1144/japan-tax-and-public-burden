import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createValidators, readYaml, validateDocument } from "./schema-validator.js";
import { validateRepository } from "./repository-validator.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
let errors = [];

const argumentsMap = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));

if (argumentsMap.file || argumentsMap.schema) {
  const schemaName = argumentsMap.schema;
  const schemaPath = schemaName ? join(root, `schemas/${schemaName}.schema.json`) : null;
  if (!argumentsMap.file || !schemaPath) {
    errors.push("Both --file and --schema are required.");
  } else {
    try {
      const validators = await createValidators({ [schemaName]: schemaPath });
      const parsed = await readYaml(argumentsMap.file);
      const documents = schemaName !== "source" && Array.isArray(parsed) ? parsed : [parsed];
      documents.forEach((document, index) => errors.push(...validateDocument(validators[schemaName], document, `${argumentsMap.file}[${index}]`)));
    } catch (error) {
      errors.push(`${argumentsMap.file}: ${error.message}`);
    }
  }
} else {
  ({ errors } = await validateRepository(root));
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("All configuration and data files conform to their JSON Schemas.");
}
