import { expect, test } from "bun:test";
import { existsSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openWorkspaceDatabase } from "./workspace-database";
import { openDatabase } from "./connection";
import { withDirectory } from "../__test-support__/fixtures";

test("workspace creation produces private SQLite storage and never replaces a missing configured database", () => withDirectory(dir => {
  const path = join(dir, "db");
  expect(() => openWorkspaceDatabase(path, false, false, openDatabase)).toThrow(expect.objectContaining({ code: "DATABASE_MISSING" }));
  expect(existsSync(path)).toBe(false);
  const db = openWorkspaceDatabase(path, true, false, openDatabase);
  try { expect(db.query("SELECT count(*) AS n FROM projects").get()).toEqual({ n: 0 }); }
  finally { db.close(); }
  expect(statSync(path).mode & 0o777).toBe(0o600);
}));

test("unsafe sidecars are rejected before SQLite can touch their targets", () => withDirectory(dir => {
  const target = join(dir, "target"), path = join(dir, "db");
  writeFileSync(target, "private"); symlinkSync(target, path + "-wal");
  expect(() => openWorkspaceDatabase(path, true, false, openDatabase)).toThrow(expect.objectContaining({ code: "DATABASE_PATH_UNSAFE" }));
  expect(existsSync(path)).toBe(false);
}));
