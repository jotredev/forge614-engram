import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testInstalledServer } from "./self-test";

test("pre-cancelled inspection never launches the supplied installation", async () => {
  const controller = new AbortController(); controller.abort();
  expect(await testInstalledServer("/nonexistent/engram", { signal: controller.signal })).toEqual({ status: "not-run", code: "CANCELLED" });
});

test("missing installation yields bounded MCP failure under isolated home", async () => {
  const home = mkdtempSync(join(tmpdir(), "engram-self-test-"));
  try {
    expect(await testInstalledServer(join(home, "missing"), { signal: new AbortController().signal, home, timeoutMs: 1000 })).toEqual({ status: "failed", code: "MCP_FAILED" });
  } finally { rmSync(home, { recursive: true, force: true }); }
});
