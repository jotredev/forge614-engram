/** Comprueba la recuperación segura de un bloqueo de migración abandonado. */
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMemoryMigrationLock } from "./memory-migration-lock";

test("reclaims a migration lock whose owner process no longer exists", () => {
  const root = mkdtempSync(join(tmpdir(), "engram-stale-lock-"));
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, ".memory-migration.lock"), JSON.stringify({ pid: 2_000_000_000, token: "dead-owner" }));
    expect(withMemoryMigrationLock(root, () => "lock acquired")).toBe("lock acquired");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
