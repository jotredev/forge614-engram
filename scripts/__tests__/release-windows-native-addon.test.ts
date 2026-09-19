import { expect, test } from "bun:test";

const workflow = await Bun.file(new URL("../../.github/workflows/release.yml", import.meta.url)).text();

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
