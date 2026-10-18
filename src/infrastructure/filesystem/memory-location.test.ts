/** Pruebas de la selección y migración segura entre `engram/` y `memory/`. */
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, closeDatabase } from "../sqlite/connection";
import { withDirectory } from "../__test-support__/fixtures";
import { ensureMemoryBeforeUninstall, resolveMemoryDirectory } from "./memory-location";

function createLegacyDatabase(path: string, title: string): void {
  const db = openDatabase(path, {});
  try {
    db.query("INSERT INTO projects VALUES ('p','Project','now','now')").run();
    db.query("INSERT INTO memories(id,projectId,scope,topic_key,type,title,content,pinned,version,state,created_at,updated_at) VALUES ('m','p','project',NULL,'fact',?, 'content',0,1,'active','now','now')").run(title);
  } finally { closeDatabase(db); }
}

test("new installations choose memory/", () => withDirectory(root => {
  expect(resolveMemoryDirectory(root, join(root, "engram"))).toBe(join(root, "memory"));
}));

test("migrates a closed 1.9.0 database, .env and file permissions atomically", () => withDirectory(root => {
  const oldHome = join(root, "engram");
  mkdirSync(oldHome, { recursive: true, mode: 0o700 });
  createLegacyDatabase(join(oldHome, "engram.db"), "legacy title");
  const legacyEnv = 'POSTGRES_URL="postgresql://example.invalid/test"\nINSTALLATION_ID="test-id"\n';
  writeFileSync(join(oldHome, ".env"), legacyEnv, { mode: 0o600 });

  expect(resolveMemoryDirectory(root, oldHome)).toBe(join(root, "memory"));
  expect(existsSync(join(root, "memory", "engram.db"))).toBe(true);
  expect(readFileSync(join(root, "memory", ".env"), "utf8")).toBe(legacyEnv);
  expect(readdirSync(oldHome)).toEqual([]);
  const copy = openDatabase(join(root, "memory", "engram.db"), { readonly: true });
  try { expect(copy.query("SELECT title FROM memories").get()).toEqual({ title: "legacy title" }); }
  finally { closeDatabase(copy); }
  if (process.platform !== "win32") {
    expect((statSync(join(root, "memory")).mode & 0o777)).toBe(0o700);
    expect((statSync(join(root, "memory", ".env")).mode & 0o777)).toBe(0o600);
  }
}));

test("migrates into an existing memory folder while preserving its current .env", () => withDirectory(root => {
  const oldHome = join(root, "engram");
  mkdirSync(oldHome, { recursive: true });
  mkdirSync(join(root, "memory"), { recursive: true });
  createLegacyDatabase(join(oldHome, "engram.db"), "legacy title");
  writeFileSync(join(oldHome, ".env"), 'INSTALLATION_ID="legacy-id"\n');
  const currentEnv = 'INSTALLATION_ID="current-id"\n';
  writeFileSync(join(root, "memory", ".env"), currentEnv);
  expect(resolveMemoryDirectory(root, oldHome)).toBe(join(root, "memory"));
  expect(readFileSync(join(root, "memory", ".env"), "utf8")).toBe(currentEnv);
  const copy = openDatabase(join(root, "memory", "engram.db"), { readonly: true });
  try { expect(copy.query("SELECT title FROM memories").get()).toEqual({ title: "legacy title" }); }
  finally { closeDatabase(copy); }
  expect(readdirSync(oldHome)).toEqual([]);
}));

test("an open legacy transaction keeps using engram/ and is retried later", () => withDirectory(root => {
  const oldHome = join(root, "engram");
  mkdirSync(oldHome, { recursive: true });
  createLegacyDatabase(join(oldHome, "engram.db"), "held title");
  const held = openDatabase(join(oldHome, "engram.db"), {});
  held.exec("BEGIN IMMEDIATE");
  try {
    expect(resolveMemoryDirectory(root, oldHome)).toBe(oldHome);
    expect(existsSync(join(root, "memory", "engram.db"))).toBe(false);
  } finally { held.exec("ROLLBACK"); closeDatabase(held); }
  expect(resolveMemoryDirectory(root, oldHome)).toBe(join(root, "memory"));
}));

test("an open transaction held by another process keeps the legacy path until it closes", async () => {
  const root = mkdtempSync(join(tmpdir(), "engram-cross-process-"));
  const oldHome = join(root, "engram");
  mkdirSync(oldHome, { recursive: true });
  const database = join(oldHome, "engram.db");
  createLegacyDatabase(database, "held connection");
  const child = Bun.spawn([process.execPath, "-e", `const { Database } = require('bun:sqlite'); const db = new Database(${JSON.stringify(database)}); db.query('SELECT COUNT(*) FROM memories').get(); db.exec('BEGIN IMMEDIATE'); console.log('ready'); setTimeout(() => db.close(), 30000);`], { stdout: "pipe", stderr: "pipe" });
  try {
    const reader = child.stdout.getReader();
    await reader.read();
    expect(resolveMemoryDirectory(root, oldHome)).toBe(oldHome);
    expect(existsSync(join(root, "memory", "engram.db"))).toBe(false);
    child.kill();
    await child.exited;
    expect(resolveMemoryDirectory(root, oldHome)).toBe(join(root, "memory"));
  } finally {
    if (child.exitCode === null) { child.kill(); await child.exited; }
    rmSync(root, { recursive: true, force: true });
  }
}, 40000);

test("a failure after copying leaves the legacy files intact and no partial memory folder", () => withDirectory(root => {
  const oldHome = join(root, "engram");
  mkdirSync(oldHome, { recursive: true });
  createLegacyDatabase(join(oldHome, "engram.db"), "untouched title");
  const oldBytes = readFileSync(join(oldHome, "engram.db"));
  const previous = process.env.FORGE614_MEMORY_MIGRATION_TEST_FAIL;
  process.env.NODE_ENV = "test";
  process.env.FORGE614_MEMORY_MIGRATION_TEST_FAIL = "after-copy";
  try { expect(() => resolveMemoryDirectory(root, oldHome)).toThrow("Injected memory migration failure"); }
  finally {
    if (previous === undefined) delete process.env.FORGE614_MEMORY_MIGRATION_TEST_FAIL;
    else process.env.FORGE614_MEMORY_MIGRATION_TEST_FAIL = previous;
  }
  expect(readFileSync(join(oldHome, "engram.db"))).toEqual(oldBytes);
  expect(existsSync(join(root, "memory"))).toBe(false);
}));

test("self-uninstall takes a consistent online copy when the legacy database is open", async () => {
  const root = mkdtempSync(join(tmpdir(), "engram-online-backup-"));
  try {
    const oldHome = join(root, "engram");
    mkdirSync(oldHome, { recursive: true });
    createLegacyDatabase(join(oldHome, "engram.db"), "committed memory");
    writeFileSync(join(oldHome, ".env"), 'POSTGRES_URL="postgresql://example.invalid/test"\n', { mode: 0o600 });
    const held = openDatabase(join(oldHome, "engram.db"), {});
    held.exec("BEGIN IMMEDIATE");
    try {
      await ensureMemoryBeforeUninstall(root, oldHome);
      expect(existsSync(join(root, "memory", "engram.db"))).toBe(true);
      expect(readFileSync(join(root, "memory", ".env"), "utf8")).toContain("example.invalid");
      const copy = openDatabase(join(root, "memory", "engram.db"), { readonly: true });
      try { expect(copy.query("SELECT title FROM memories").get()).toEqual({ title: "committed memory" }); }
      finally { closeDatabase(copy); }
    } finally { held.exec("ROLLBACK"); closeDatabase(held); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("memory/ wins when both databases exist and the old database is untouched", () => withDirectory(root => {
  const oldHome = join(root, "engram");
  mkdirSync(oldHome, { recursive: true });
  mkdirSync(join(root, "memory"), { recursive: true });
  createLegacyDatabase(join(oldHome, "engram.db"), "legacy title");
  createLegacyDatabase(join(root, "memory", "engram.db"), "canonical title");
  const oldBytes = readFileSync(join(oldHome, "engram.db"));
  expect(resolveMemoryDirectory(root, oldHome)).toBe(join(root, "memory"));
  expect(readFileSync(join(oldHome, "engram.db"))).toEqual(oldBytes);
}));
