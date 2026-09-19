# Windows Native Release Bundling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and embed the Windows reparse-point addon in each Windows standalone release executable, then prove the packaged executable loads it from an isolated user profile.

**Architecture:** The Windows release matrix provides an addon architecture alongside Bun's executable target. The workflow installs build-only tooling, invokes the existing addon build script before `bun build --compile`, and runs the completed executable with `assistant-list` under a temporary profile. A colocated workflow-contract test prevents future releases from omitting or reordering those operations.

**Tech Stack:** TypeScript, Bun 1.3.x standalone compilation, GitHub Actions, PowerShell, Node-API, node-gyp 12.1.0, Visual Studio 2026 Build Tools.

**Spec:** `docs/superpowers/specs/2026-09-18-windows-native-release-bundling-design.md`

## Global Constraints

- End users download one Windows `.exe`; they install no Bun, Node.js, Python, compiler, or separate `.node` file.
- The release matrix must produce matching x64 and ARM64 addon/executable pairs.
- Windows build tools are used only on GitHub's temporary release runners.
- The addon remains loaded by the existing direct literal `require()` so Bun embeds it.
- The release check must use a temporary profile outside the repository and must not create `.forge614` storage.
- A manual release-validation run builds and verifies artifacts without publishing a GitHub Release.
- Public documentation is updated only after the GitHub workflow succeeds.

## Review Focus

- ARM64 uses an ARM64 addon and never silently reuses an x64 binary.
- A missing or empty addon stops Windows artifact construction before publication.
- The packaged `.exe` loads its embedded addon without source-tree paths beside it.
- `assistant-list` uses only a temporary profile and creates no user storage.
- macOS and Linux release matrix entries do not acquire Windows-only tools or commands.

### Task 1: Release workflow contract

**Files:**
- Modify: `.github/workflows/release.yml`
- Test: `scripts/__tests__/release-windows-native-addon.test.ts`

**Interfaces:**
- Consumes: `scripts/build-windows-reparse-addon.ps1 -Architecture x64|arm64`
- Produces: Windows build matrix rows that expose `addon_architecture` and build an embedded addon before `bun build --compile`.

- [ ] **Step 1: Write the failing workflow-contract test**

Create a test that reads `.github/workflows/release.yml` and requires these exact facts:

```ts
expect(workflow).toContain("addon_architecture: x64");
expect(workflow).toContain("addon_architecture: arm64");
expect(workflow).toContain("./scripts/build-windows-reparse-addon.ps1 -Architecture ${{ matrix.addon_architecture }}");
expect(workflow.indexOf("Build Windows reparse addon")).toBeLessThan(workflow.indexOf("Compile standalone artifact"));
expect(workflow).toContain("assistant-list");
expect(workflow).toContain("workflow_dispatch:");
expect(workflow).toContain("github.ref_type == 'tag'");
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun test scripts/__tests__/release-windows-native-addon.test.ts`

Expected: failure because the current release workflow has no addon architecture, Windows addon build, or packaged addon load check.

- [ ] **Step 3: Add Windows build prerequisites and ordered native build**

Extend only the Windows build rows with `addon_architecture`. Add Windows-only Node 22.14, Python 3.12, and a PowerShell step:

```yaml
- name: Build Windows reparse addon
  if: runner.os == 'Windows'
  shell: pwsh
  run: ./scripts/build-windows-reparse-addon.ps1 -Architecture ${{ matrix.addon_architecture }}
```

Place it after `bun install --frozen-lockfile --ignore-scripts` and before `Compile standalone artifact`.

- [ ] **Step 4: Add the packaged-addon smoke check**

In the Windows smoke-test step, create a directory under `$env:RUNNER_TEMP`, set `HOME`, `USERPROFILE`, `LOCALAPPDATA`, `APPDATA`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, and `XDG_CONFIG_HOME` to descendants of that directory, execute the compiled executable with `assistant-list`, parse its JSON output, and assert it contains the five supported clients. Assert that the temporary profile has no `.forge614` directory after the command.

- [ ] **Step 5: Run the workflow-contract test and typecheck**

Run: `bun test scripts/__tests__/release-windows-native-addon.test.ts && bun run typecheck`

Expected: both commands exit with code 0.

### Task 2: Release execution verification

**Files:**
- Modify: `.github/workflows/release.yml`
- Test: `scripts/__tests__/release-windows-native-addon.test.ts`

**Interfaces:**
- Consumes: compiled `dist/${{ matrix.artifact }}` and isolated profile variables from Task 1.
- Produces: a release job that proves the actual Windows executable loads the embedded Node-API addon.

- [ ] **Step 1: Extend the failing contract test for isolation**

Require the PowerShell release smoke test to set a unique directory under `RUNNER_TEMP`, invoke the executable by its `dist` path, call `assistant-list`, and check the absence of `.forge614`.

- [ ] **Step 2: Run the contract test and confirm the new assertions fail**

Run: `bun test scripts/__tests__/release-windows-native-addon.test.ts`

Expected: failure until the release smoke test makes the profile and storage checks explicit.

- [ ] **Step 3: Implement the isolated execution check**

Use PowerShell's `New-Guid` and `Join-Path`, a `try/finally` cleanup, and `ConvertFrom-Json`. Do not call `setup`, `tui`, or an installer. `assistant-list` invokes route inspection without writing configuration or initializing the database.

- [ ] **Step 4: Re-run focused checks**

Run: `bun test scripts/__tests__/release-windows-native-addon.test.ts scripts/__tests__/build-windows-reparse-addon.test.ts && git diff --check`

Expected: both tests pass and the diff has no whitespace errors.

### Task 3: Repository verification and handoff

**Files:**
- Modify: `.github/workflows/release.yml`
- Create: `scripts/__tests__/release-windows-native-addon.test.ts`
- Create: `docs/superpowers/specs/2026-09-18-windows-native-release-bundling-design.md`
- Create: `docs/superpowers/plans/2026-09-18-windows-native-release-bundling.md`

- [ ] **Step 1: Add a non-publishing manual release-validation mode**

Add `workflow_dispatch` as a trigger. Keep publication limited to tag pushes by
guarding the publish job with `github.event_name == 'push' &&
github.ref_type == 'tag'`. Manual runs still upload assembled artifacts but do
not create a GitHub Release.

- [ ] **Step 2: Run the full local suite**

Run: `bun test`

Expected: zero failing tests; Windows-only runtime tests may be skipped locally on non-Windows hosts.

- [ ] **Step 3: Run static checks**

Run: `bun run typecheck && git diff --check`

Expected: both commands exit with code 0.

- [ ] **Step 4: Inspect the final diff against the specification**

Verify the matrix has x64 and ARM64 architecture pairing, both Windows jobs build first, the executable smoke test runs outside the repository, and no public documentation asserts release success before GitHub validates it.

- [ ] **Step 5: Hand off for GitHub verification**

The user commits and pushes the branch, then runs the release workflow manually from the branch. GitHub Actions validates the actual Windows x64 and ARM64 release jobs and produces inspectable artifacts without publishing a release. A later `v*` tag runs the same checks and may publish only after they pass.
