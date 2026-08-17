import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDistributionArtifacts, compareArtifactSets } from "./distribution-generator.js";

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
    const artifacts = await buildDistributionArtifacts(root, { asOf });
    if (check) {
      if (requestedOutput !== "generated") throw new Error("--check only supports the tracked generated directory");
      const existing = (await readdir(outputDirectory, { withFileTypes: true })).filter((entry) => entry.isFile()).map(({ name }) => name).sort();
      const actual = new Map(await Promise.all(existing.map(async (name) => [name, await readFile(join(outputDirectory, name), "utf8")])));
      const differences = compareArtifactSets(artifacts, actual);
      if (differences.length > 0) throw new Error(`Generated artifacts differ:\n${differences.join("\n")}`);
      console.log(JSON.stringify({ status: "clean", files: artifacts.size }));
    } else {
      await mkdir(outputDirectory, { recursive: true });
      for (const [name, content] of artifacts) {
        const target = join(outputDirectory, name);
        const temporary = `${target}.tmp`;
        await writeFile(temporary, content, "utf8");
        await rename(temporary, target);
      }
      console.log(JSON.stringify({ status: "generated", output_directory: requestedOutput, files: artifacts.size }));
    }
  } catch (error) {
    console.error(JSON.stringify({ status: "error", error: error.message }));
    process.exitCode = 1;
  }
}
