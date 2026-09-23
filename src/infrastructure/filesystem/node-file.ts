import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { groupName } from "../../modules/ecosystem";

const MAX_BYTES = 64 * 1024;

/**
 * forge614.node.json belongs to another node: Engram only reads its optional `ecosystem` name and
 * ignores anything unusable (the ecosystem verifier owns that file's validation).
 */
export function readNodeEcosystem(root: string): string | null {
  const path = join(root, "forge614.node.json");
  try {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink() || !entry.isFile() || entry.size > MAX_BYTES) return null;
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const declared = (value as { ecosystem?: unknown }).ecosystem;
    return typeof declared === "string" ? groupName(declared) : null;
  } catch { return null; }
}
