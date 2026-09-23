import type { Stats } from "node:fs";
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { groupName,uuidV4 } from "../../modules/ecosystem";
import { MemoryError } from "../../shared/errors";

const MAX_BYTES = 64 * 1024;

function accepts(check: (value: unknown) => unknown, value: unknown): boolean {
  try { check(value); return true; } catch { return false; }
}

// The boundary schema is zod `.strict()` (unknown fields and unknown schema versions are rejected), but zod is
// loaded on first use: only a repository that carries this file pays for it, never the common startup path.
// `require` keeps the read path synchronous; a top-level import would load zod (and its locales) on every command.
let schema: { safeParse(value: unknown): { success: boolean; data?: unknown } } | null = null;
function projectFileSchema(): NonNullable<typeof schema> {
  if (schema) return schema;
  const { z } = require("zod") as typeof import("zod");
  const uuid = z.string().refine(value => accepts(uuidV4, value));
  const label = z.string().max(300).refine(value => value.trim().length > 0 && !value.includes("\0"));
  const group = z.object({ id: uuid, name: z.string().refine(value => accepts(groupName, value)) }).strict();
  // `ecosystem` may be absent in a file written before the group was known; Engram completes it.
  schema = z.object({
    schemaVersion: z.literal(1),
    project: z.object({ id: uuid, name: label }).strict(),
    ecosystem: group.nullable().optional(),
  }).strict();
  return schema;
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
  const parsed = projectFileSchema().safeParse(value);
  if (!parsed.success) invalid();
  return parsed.data as ProjectFile;
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
