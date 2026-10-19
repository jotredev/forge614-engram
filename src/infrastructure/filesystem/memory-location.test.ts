/** Pruebas de la selección y migración segura entre `engram/` y `memory/`. */
import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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

test("recovers an interrupted Windows migration probe before selecting the legacy path", () => withDirectory(root => {
  const oldHome = join(root, "engram");
  mkdirSync(oldHome, { recursive: true });
  const database = join(oldHome, "engram.db");
  createLegacyDatabase(database, "probe recovery");
  renameSync(database, `${database}.migration-probe`);

  expect(resolveMemoryDirectory(root, oldHome)).toBe(join(root, "memory"));
  expect(existsSync(join(root, "memory", "engram.db"))).toBe(true);
  expect(existsSync(database)).toBe(false);
  expect(existsSync(`${database}.migration-probe`)).toBe(false);
}));

test("version and help commands do not inspect or migrate an open legacy database", () => withDirectory(root => {
  const oldHome = join(root, "engram");
  mkdirSync(oldHome, { recursive: true });
  const database = join(oldHome, "engram.db");
  createLegacyDatabase(database, "still open");
  const held = openDatabase(database, {});
  const shimDirectory = join(root, "bin");
  mkdirSync(shimDirectory);
  const lsofCalls = join(root, "lsof-called");
  const lsofShim = join(shimDirectory, "lsof");
  writeFileSync(lsofShim, `#!/bin/sh\nprintf called >> ${JSON.stringify(lsofCalls)}\n`, { mode: 0o700 });
  chmodSync(lsofShim, 0o700);
  const cli = join(import.meta.dir, "../../cli.ts");
  try {
    for (const args of [["--version"], ["--version", "--json"], ["--help"]]) {
      const result = Bun.spawnSync([process.execPath, cli, ...args], {
        env: { ...process.env, HOME: root, FORGE614_HOME: root, PATH: shimDirectory },
        stdout: "pipe", stderr: "pipe",
      });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
    }
    expect(existsSync(join(root, "memory"))).toBe(false);
    expect(existsSync(database)).toBe(true);
    expect(existsSync(lsofCalls)).toBe(false);
  } finally { closeDatabase(held); }
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

test("concurrent real subprocess saves during the 1.9 migration all land in memory/engram.db", async () => {
  const root = mkdtempSync(join(tmpdir(), "engram-migration-race-"));
  try {
    const oldHome = join(root, "engram");
    mkdirSync(oldHome, { recursive: true });
    createLegacyDatabase(join(oldHome, "engram.db"), "seed");
    const memoryStoreModule = join(import.meta.dir, "../../app/memory-store.ts");
    const children = Array.from({ length: 8 }, (_, index) => Bun.spawn([process.execPath, "-e", `import { MemoryStore } from ${JSON.stringify(memoryStoreModule)}; const store = new MemoryStore(); store.save({ projectId: null, scope: "shared", title: "race-${index}", content: "content-${index}", type: "fact" }); store.close();`], {
      cwd: root,
      env: { ...process.env, HOME: root, FORGE614_HOME: root },
      stdout: "pipe",
      stderr: "pipe",
    }));
    const results = await Promise.all(children.map(async child => ({
      code: await child.exited,
      stdout: await new Response(child.stdout).text(),
      stderr: await new Response(child.stderr).text(),
    })));
    if (results.some(result => result.code !== 0)) throw new Error(JSON.stringify(results));
    expect(results.map(result => result.stderr)).toEqual(Array(8).fill(""));
    expect(existsSync(join(root, "memory", "engram.db"))).toBe(true);
    expect(existsSync(join(oldHome, "engram.db"))).toBe(false);
    const store = openDatabase(join(root, "memory", "engram.db"), { readonly: true });
    try {
      const titles = store.query("SELECT title FROM memories WHERE title LIKE 'race-%' ORDER BY title").all() as { title: string }[];
      expect(titles.map(item => item.title)).toEqual(["race-0", "race-1", "race-2", "race-3", "race-4", "race-5", "race-6", "race-7"]);
    } finally { closeDatabase(store); }
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 60000);

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
