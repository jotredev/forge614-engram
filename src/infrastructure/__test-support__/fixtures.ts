import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../sqlite/connection";

export function withDatabase(run: (db: Database) => void): void {
  const db = openDatabase(":memory:", {});
  try { run(db); } finally { db.close(); }
}

export function withDirectory(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "engram-adapter-"));
  try { run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}
