import { expect, test } from "bun:test";

const workflow = await Bun.file(new URL("../../.github/workflows/release.yml", import.meta.url)).text();
const powershell = process.env.FORGE614_TEST_PWSH ?? Bun.which("pwsh");

// Exercise the workflow's actual validation against assistant-list results:
// a missing native addon returns blocked descriptors while keeping exit code 0.
const smokeTest = powershell ? test : test.skip;
smokeTest("Windows release smoke rejects blocked inspection even when every assistant ID is present", () => {
  const validation = workflow.match(/(          foreach \(\$id in @\('claude-code'[\s\S]+?)(?=          if \(Test-Path)/)?.[1];
  if (!validation) throw new Error("Could not locate the Windows assistant-list validation.");
  const ids = ["claude-code", "codex", "cursor", "opencode", "antigravity"];
  for (const blockedId of [null, ...ids]) {
    const descriptors = ids.map(id => ({ id, configuration: { status: id === blockedId ? "blocked" : "absent" } }));
    const result = Bun.spawnSync([
      powershell!, "-NoProfile", "-NonInteractive", "-Command",
      `$ErrorActionPreference = 'Stop'; $assistants = ConvertFrom-Json '${JSON.stringify(descriptors)}';\n${validation}`,
    ]);
    if (blockedId === null) expect(result.exitCode, result.stderr.toString()).toBe(0);
    else expect(result.exitCode, `Accepted blocked ${blockedId} inspection`).not.toBe(0);
  }
}, 15_000);

test("Windows release artifacts build and load their matching embedded native addon", () => {
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).toContain("addon_architecture: x64");
  expect(workflow).toContain("addon_architecture: arm64");
  expect(workflow).toContain("actions/setup-node@v4");
  expect(workflow).toContain("actions/setup-python@v5");
  expect(workflow).toContain("./scripts/build-windows-reparse-addon.ps1 -Architecture ${{ matrix.addon_architecture }}");
  expect(workflow.indexOf("Build Windows reparse addon")).toBeLessThan(workflow.indexOf("Compile standalone artifact"));
  expect(workflow).toContain("assistant-list");
  expect(workflow).toContain("RUNNER_TEMP");
  expect(workflow).toContain("github.event_name == 'push' && github.ref_type == 'tag'");
  expect(workflow).not.toContain("shell: ${{ matrix.shell }}");
});
