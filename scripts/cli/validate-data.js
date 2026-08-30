import { fileURLToPath } from "node:url";
import { validateData } from "../application/repository-operations.js";
import { validateFile } from "../composition/repository-validation.js";
import { validateRepository } from "../composition/repository-validator.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const argumentsMap = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));

const { errors } = await validateData({ root, file: argumentsMap.file, schema: argumentsMap.schema, validateRepository, validateFile });

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("All configuration and data files conform to their JSON Schemas.");
}
