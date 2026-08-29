import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function loadCanonicalMaster(repositoryRoot) {
  return JSON.parse(await readFile(join(repositoryRoot, "data/master/canonical.json"), "utf8"));
}

export async function loadLegacyBurdens(repositoryRoot) {
  const master = await loadCanonicalMaster(repositoryRoot);
  return master.public_burdens.map(({ public_burden_id, legacy_record }) => {
    if (!legacy_record) throw new Error(`${public_burden_id}: legacy_record is required for monitoring migration compatibility`);
    return legacy_record;
  });
}
