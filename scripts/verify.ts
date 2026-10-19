/** Run Engram's typecheck and suite with isolated Forge614 storage. */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const temporaryRoot = await mkdtemp(join(tmpdir(), "forge614-engram-verify-"));
try {
  const home = join(temporaryRoot, "home");
  const forgeHome = join(home, ".forge614");
  await mkdir(forgeHome, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, FORGE614_HOME: forgeHome };
  for (const args of [["test"], ["run", "typecheck"]]) {
    const result = spawnSync("bun", args, { stdio: "inherit", env });
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
