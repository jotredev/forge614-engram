import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { required } from "./memory";
import { initialize } from "./schema";
export { defaultDatabasePath } from "../filesystem/paths";

export function openDatabase(path: string, options: {create?: boolean; readonly?: boolean}): Database {
  required(path, "path");
  const create = options.create ?? !options.readonly;
  if (create && path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { create, readwrite: !options.readonly, readonly: options.readonly ?? false, strict: true });
  try { initialize(db, create, options.readonly ?? false); }
  catch (error) { db.close(); throw error; }
  return db;
}
export function closeDatabase(db: Database): void { db.close(); }
