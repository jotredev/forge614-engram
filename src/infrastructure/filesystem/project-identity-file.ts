import type { Stats } from "node:fs";
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { groupName,uuidV4 } from "../../modules/ecosystem";
import { MemoryError } from "../../shared/errors";

const MAX_BYTES = 64 * 1024;

// A strict, hand-written schema: unknown fields and unknown schema versions are rejected. It avoids
// loading zod on the startup path of every session (see the v1.5.3 loader investigation).
function record(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const found = Object.keys(value);
  if (found.some(key => !keys.includes(key) && !optional.includes(key))) return null;
  if (keys.some(key => !found.includes(key))) return null;
  return value as Record<string, unknown>;
}
function accepts(check: (value: unknown) => unknown, value: unknown): boolean {
  try { check(value); return true; } catch { return false; }
}
function parseGroup(value: unknown): ProjectFileGroup | null {
  const data = record(value, ["id", "name"]);
  return data && accepts(uuidV4, data.id) && accepts(groupName, data.name) ? { id: data.id as string, name: data.name as string } : null;
}
function parseProjectFile(value: unknown): ProjectFile | null {
  const data = record(value, ["schemaVersion", "project"], ["ecosystem"]);
  if (!data || data.schemaVersion !== 1) return null;
  const project = record(data.project, ["id", "name"]);
  if (!project || !accepts(uuidV4, project.id) || typeof project.name !== "string"
    || project.name.length > 300 || project.name.trim().length === 0 || project.name.includes("\0")) return null;
  const file: ProjectFile = { schemaVersion: 1, project: { id: project.id as string, name: project.name } };
  // `ecosystem` may be absent in a file written before the group was known; Engram completes it.
  if (!("ecosystem" in data) || data.ecosystem === undefined) return file;
  if (data.ecosystem === null) return { ...file, ecosystem: null };
  const group = parseGroup(data.ecosystem);
  return group ? { ...file, ecosystem: group } : null;
}

export interface ProjectFileGroup { id: string; name: string }
export interface ProjectFile { schemaVersion: 1; project: { id: string; name: string }; ecosystem?: ProjectFileGroup | null | undefined }
export interface WantedProjectFile { projectId: string; name: string; ecosystem: ProjectFileGroup | null }
export type EnsureStatus = "created" | "completed" | "unchanged";

export function projectFilePath(root: string): string { return join(root, ".forge614", "project.json"); }

function invalid(): never {
  throw new MemoryError("PROJECT_FILE_INVALID", "El archivo .forge614/project.json no es válido; no se modificó. Corrígelo o bórralo para que Engram lo regenere.");
}
function entry(path: string): Stats | null {
  try { return lstatSync(path) ?? null; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; return invalid(); }
}
function serialize(file: ProjectFile): string {
  return `${JSON.stringify({ schemaVersion: 1, project: file.project, ecosystem: file.ecosystem === undefined ? null : file.ecosystem }, null, 2)}\n`;
}

/** Reads the identity file of a repository root: null when absent, PROJECT_FILE_INVALID when unusable. */
export function readProjectFile(root: string): ProjectFile | null {
  const folder = entry(join(root, ".forge614"));
  if (folder === null) return null;
  if (folder.isSymbolicLink() || !folder.isDirectory()) invalid();
  const path = projectFilePath(root);
  const file = entry(path);
  if (file === null) return null;
  if (file.isSymbolicLink() || !file.isFile() || file.size > MAX_BYTES) invalid();
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, "utf8")); } catch { return invalid(); }
  return parseProjectFile(value) ?? invalid();
}

function temporary(root: string, content: string): string {
  const path = join(root, ".forge614", `.project.json.tmp-${crypto.randomUUID()}`);
  const fd = openSync(path, "wx", 0o644);
  try { writeSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
  return path;
}
function replace(root: string, content: string): void {
  const source = temporary(root, content);
  try { renameSync(source, projectFilePath(root)); }
  catch (error) { try { unlinkSync(source); } catch { /* Retain recoverable material on cleanup failure. */ } throw error; }
}
/** Publishes a new file without ever replacing one that another writer created first. */
function create(root: string, content: string): boolean {
  mkdirSync(join(root, ".forge614"), { recursive: true, mode: 0o755 });
  const source = temporary(root, content);
  try {
    try { linkSync(source, projectFilePath(root)); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      // Hard links can be unavailable on some filesystems; fall back to a checked rename.
      if (entry(projectFilePath(root)) !== null) return false;
      renameSync(source, projectFilePath(root)); return true;
    }
  } finally { try { unlinkSync(source); } catch { /* Already renamed or retained. */ } }
}

/**
 * Silent and idempotent: creates the file when absent; otherwise reads it, never replaces or
 * changes ids and only completes a missing ecosystem field (or a null one when `fillGroup`).
 */
export function ensureProjectFile(root: string, wanted: WantedProjectFile, options: { fillGroup?: boolean } = {}): { status: EnsureStatus; file: ProjectFile } {
  const existing = readProjectFile(root);
  if (existing === null) {
    const file: ProjectFile = { schemaVersion: 1, project: { id: wanted.projectId, name: wanted.name }, ecosystem: wanted.ecosystem };
    if (create(root, serialize(file))) return { status: "created", file };
    const winner = readProjectFile(root);
    if (winner === null) return invalid();
    return { status: "unchanged", file: winner };
  }
  const fill = existing.ecosystem === undefined || (existing.ecosystem === null && options.fillGroup === true && wanted.ecosystem !== null);
  if (!fill) return { status: "unchanged", file: existing };
  const file: ProjectFile = { ...existing, ecosystem: wanted.ecosystem };
  replace(root, serialize(file));
  return { status: "completed", file };
}

/** Rename or regroup: identifiers stay; returns null when the repository has no file yet. */
export function updateProjectFile(root: string, patch: { name?: string; ecosystem?: ProjectFileGroup | null }): ProjectFile | null {
  const existing = readProjectFile(root);
  if (existing === null) return null;
  const next: ProjectFile = {
    schemaVersion: 1,
    project: { id: existing.project.id, name: patch.name ?? existing.project.name },
    ecosystem: patch.ecosystem === undefined ? existing.ecosystem : patch.ecosystem,
  };
  if (serialize(next) !== serialize(existing)) replace(root, serialize(next));
  return next;
}
