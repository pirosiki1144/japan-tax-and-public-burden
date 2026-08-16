import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

export async function readYaml(path) {
  return parse(await readFile(path, "utf8"));
}

export async function createValidators(schemaPaths) {
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strict: true });
  addFormats(ajv);
  const validators = {};
  for (const [name, path] of Object.entries(schemaPaths)) {
    const schema = JSON.parse(await readFile(path, "utf8"));
    validators[name] = ajv.compile(schema);
  }
  return validators;
}

export function validateDocument(validate, document, location) {
  if (validate(document)) return [];
  return (validate.errors ?? []).map((error) => {
    const path = error.instancePath || "/";
    return `${location}${path}: ${error.message}`;
  });
}
