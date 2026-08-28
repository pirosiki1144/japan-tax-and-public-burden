import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { filesystemStore } from "../adapters/filesystem-store.js";
import { generateDistribution } from "../application/repository-operations.js";
import { buildDistributionArtifacts } from "./distribution-generator.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const check = args.includes("--check");
const asOf = option("as-of");
const requestedOutput = option("output-dir") ?? "generated";
const outputDirectory = resolve(root, requestedOutput);
const allowedRoot = `${resolve(root)}${sep}`;
const allowedOutput = requestedOutput === "generated" || /^\.cache\/[A-Za-z0-9._/-]+$/.test(requestedOutput) && !requestedOutput.split("/").includes("..");

if (!allowedOutput || !outputDirectory.startsWith(allowedRoot)) {
  console.error(JSON.stringify({ status: "error", error: "Output directory must be generated or a path under .cache/" }));
  process.exitCode = 2;
} else {
  try {
    if (check && requestedOutput !== "generated") throw new Error("--check only supports the tracked generated directory");
    const result = await generateDistribution({ root, asOf, outputDirectory, check, buildArtifacts: buildDistributionArtifacts, fileStore: filesystemStore });
    console.log(JSON.stringify({ ...result, ...(check ? {} : { output_directory: requestedOutput }) }));
  } catch (error) {
    console.error(JSON.stringify({ status: "error", error: error.message }));
    process.exitCode = 1;
  }
}
