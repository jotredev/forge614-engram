import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "./connection";
import { withDirectory } from "../__test-support__/fixtures";

test("opening creates nested storage, persists data, and readonly connections refuse writes", () => withDirectory(dir => {
  const path = join(dir, "nested", "memory.db");
  const db = openDatabase(path, {});
  db.query("INSERT INTO projects VALUES ('p','Persisted','now','now')").run();
  closeDatabase(db);
  expect(existsSync(path)).toBe(true);
  const reader = openDatabase(path, { readonly: true });
  try {
    expect(reader.query("SELECT name FROM projects").get()).toEqual({ name: "Persisted" });
    expect(() => reader.exec("DELETE FROM projects")).toThrow();
  } finally { closeDatabase(reader); }
}));

test("connect-only refuses to manufacture a missing database", () => withDirectory(dir => {
  const path = join(dir, "missing.db");
  expect(() => openDatabase(path, { create: false })).toThrow();
  expect(existsSync(path)).toBe(false);
}));
