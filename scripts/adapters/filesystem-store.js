import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function readText(path) {
  return readFile(path, "utf8");
}

export async function readJson(path) {
  return JSON.parse(await readText(path));
}

export async function listFileNames(path) {
  return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isFile()).map(({ name }) => name).sort();
}

export async function writeTextAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

export function writeJsonAtomic(path, value) {
  return writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readNamedTexts(directory, names) {
  return new Map(await Promise.all(names.map(async (name) => [name, await readText(join(directory, name))])));
}

export async function writeNamedTexts(directory, artifacts) {
  await Promise.all([...artifacts].map(([name, content]) => writeTextAtomic(join(directory, name), content)));
}

export const filesystemStore = Object.freeze({ readText, readJson, listFileNames, writeTextAtomic, writeJsonAtomic, readNamedTexts, writeNamedTexts });
