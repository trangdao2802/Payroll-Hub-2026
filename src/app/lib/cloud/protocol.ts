export const BUCKET = "payroll-workspaces";
export const PART_SIZE = 4 * 1024 * 1024;
export interface Asset {
  hash: string;
  bytes: number;
  parts: string[];
}
export interface Manifest {
  version: 1;
  fields: Record<string, Asset>;
}
export interface Workspace {
  owner_id: string;
  revision: number;
  manifest: Manifest;
  updated_at: string;
}
export function conflictingFields(
  base: Manifest,
  local: Manifest,
  remote: Manifest,
): string[] {
  return Object.keys(local.fields).filter((key) => {
    const b = base.fields[key]?.hash,
      l = local.fields[key]?.hash,
      r = remote.fields[key]?.hash;
    return l !== b && r !== b && l !== r;
  });
}
export function mergeManifest(
  base: Manifest,
  local: Manifest,
  remote: Manifest,
): Manifest {
  const fields = { ...remote.fields };
  for (const key of Object.keys(local.fields)) {
    if (local.fields[key]?.hash !== base.fields[key]?.hash)
      fields[key] = local.fields[key];
  }
  return { version: 1, fields };
}
