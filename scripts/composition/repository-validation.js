import { join } from "node:path";
import { createValidators, readYaml, validateDocument } from "../adapters/schema-validator.js";

export async function validateFile(root, file, schema) {
  const validators = await createValidators({ [schema]: join(root, `schemas/${schema}.schema.json`) });
  const parsed = await readYaml(file);
  const documents = schema !== "source" && Array.isArray(parsed) ? parsed : [parsed];
  return documents.flatMap((document, index) => validateDocument(validators[schema], document, `${file}[${index}]`));
}
