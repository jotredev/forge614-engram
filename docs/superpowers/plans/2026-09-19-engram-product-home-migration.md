# Forge614 Engram Product-Home Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every default Forge614 Engram file live under `~/.forge614/engram`, safely migrate the former layout, and add a guarded product-only uninstall flow.

**Architecture:** Introduce a path service that distinguishes the shared Forge614 parent from Engram's owned directory. Put migration and deletion behind focused filesystem services, then make workspace, installers, assistant integration, and CLI consume those services. The release installer publishes the verified platform binary to the product bin directory.

**Tech Stack:** TypeScript, Bun, Node filesystem APIs, SQLite/FTS5, Bash, PowerShell, Bun tests, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-19-engram-product-home-design.md`

## Global Constraints

- Default product home: `~/.forge614/engram`; parent `~/.forge614` can have unrelated sibling products and must never be removed.
- Default executables: `$HOME/.forge614/engram/bin/forge614-engram` and `%USERPROFILE%\\.forge614\\engram\\bin\\forge614-engram.exe`.
- Default config/database: `~/.forge614/engram/.env` and `~/.forge614/engram/engram.db`.
- Repair ordinary current-user-owned directories privately; reject links/reparse points, non-directories, foreign-owned paths, and unverified paths.
- Migrate only known legacy Engram files; never overwrite a conflicting destination or delete unknown parent content.
- Uninstall only exact managed Engram assistant entries, its PATH publication, and `~/.forge614/engram`.
- Atlas requires exact phrase `REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS` and successful self-uninstall before any Engram deletion.
- Use colocated tests and test-first implementation.
- Release version for this location-changing update is `1.1.0`.

## Review Focus

- Legacy database with `-wal` / `-shm` sidecars moves as a complete set or every source remains untouched.
- Existing `engram/` destination or database conflict rejects without replacing a file.
- Existing `~/.forge614/shell/` remains byte-for-byte unchanged through setup, installation, migration, and uninstall.
- A manually edited assistant entry that resembles Engram is refused rather than removed.
- Atlas missing/failing prevents every Engram deletion.

---

## File structure

- `src/infrastructure/filesystem/paths.ts` — parent/product path resolver.
- `src/infrastructure/filesystem/product-home.ts` and colocated test — safe directory preparation and legacy migration.
- `src/infrastructure/filesystem/workspace-config.ts` and test — default product root and migration trigger.
- `src/infrastructure/assistants/installation.ts` and test — installed binary discovery.
- `src/infrastructure/assistants/configuration.ts` and test — exact managed-entry removal plans.
- `src/infrastructure/filesystem/private-files.ts` and test — guarded rewrite/delete primitives.
- `src/app/uninstall.ts` and test — Atlas handoff and ordered cleanup.
- `src/interfaces/cli/{arguments,commands,help}.ts` and colocated tests — `uninstall` command.
- `scripts/{install.sh,install.ps1,install-from-source.sh}` and fixture tests — product-bin installation.
- `.github/workflows/release.yml` and release test — published assets regression protection.
- `package.json`, `README.md`, `docs/en/**`, `docs/es/**` — `1.1.0` release documentation after working behavior is verified.

### Task 1: Establish canonical parent and product paths

**Files:**
- Modify: `src/infrastructure/filesystem/paths.ts`
- Test: `src/infrastructure/filesystem/paths.test.ts`
- Modify: `src/infrastructure/assistants/installation.ts`
- Test: `src/infrastructure/assistants/installation.test.ts`

**Interfaces:**
- Produces `forge614Home(): string`, `engramHome(): string`, `engramBinDirectory(): string`, `defaultDatabasePath(): string`, and `legacyDatabasePath(): string`.
- Installation resolver tests the product bin before legacy `.local/bin`.

- [ ] **Step 1: Write the failing test**

```ts
test("default paths live inside the Engram product home", () => {
  expect(forge614Home()).toBe(join(homedir(), ".forge614"));
  expect(engramHome()).toBe(join(homedir(), ".forge614", "engram"));
  expect(engramBinDirectory()).toBe(join(homedir(), ".forge614", "engram", "bin"));
  expect(defaultDatabasePath()).toBe(join(homedir(), ".forge614", "engram", "engram.db"));
});
```

Add an installation-discovery test with only `join(home, ".forge614", "engram", "bin", "forge614-engram")` available.

- [ ] **Step 2: Verify it fails**

Run: `bun test src/infrastructure/filesystem/paths.test.ts src/infrastructure/assistants/installation.test.ts`

Expected: FAIL because product-home helpers and candidate do not yet exist.

- [ ] **Step 3: Implement the minimal pure helpers**

```ts
export function forge614Home(): string { return join(homedir(), ".forge614"); }
export function engramHome(): string { return join(forge614Home(), "engram"); }
export function engramBinDirectory(): string { return join(engramHome(), "bin"); }
export function defaultDatabasePath(): string { return join(engramHome(), "engram.db"); }
export function legacyDatabasePath(): string { return join(forge614Home(), "engram.db"); }
```

Keep `userStorageDirectory()` only as a backward-compatible public alias if existing SDK users import it; it must resolve to the Engram product home. Add product-bin discovery before the legacy compatibility path.

- [ ] **Step 4: Verify it passes**

Run: `bun test src/infrastructure/filesystem/paths.test.ts src/infrastructure/assistants/installation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/filesystem/paths.ts src/infrastructure/filesystem/paths.test.ts src/infrastructure/assistants/installation.ts src/infrastructure/assistants/installation.test.ts
git commit -m "feat: define the Engram product home"
```

### Task 2: Add safe legacy-workspace migration

**Files:**
- Create: `src/infrastructure/filesystem/product-home.ts`
- Create: `src/infrastructure/filesystem/product-home.test.ts`
- Modify: `src/infrastructure/filesystem/workspace-config.ts`
- Test: `src/infrastructure/filesystem/workspace-config.test.ts`

**Interfaces:**
- Produces `prepareEngramHome(): void` and `migrateLegacyEngramWorkspace(): "none" | "migrated"`.
- `WorkspaceConfig.prepare()` invokes it only for the implicit default root; explicit custom roots retain current behavior.

- [ ] **Step 1: Write failing migration tests**

```ts
test("migrates only known root-level Engram files and preserves Shell", () => {
  writeFileSync(join(parent, ".env"), sqliteConfig, { mode: 0o600 });
  writeFileSync(join(parent, "engram.db"), databaseBytes, { mode: 0o600 });
  writeFileSync(join(parent, "engram.db-wal"), walBytes, { mode: 0o600 });
  mkdirSync(join(parent, "shell"), { recursive: true });
  writeFileSync(join(parent, "shell", "keep"), "unchanged");
  expect(migrateLegacyEngramWorkspace()).toBe("migrated");
  expect(readFileSync(join(product, "engram.db"))).toEqual(databaseBytes);
  expect(existsSync(join(parent, "engram.db"))).toBe(false);
  expect(readFileSync(join(parent, "shell", "keep"), "utf8")).toBe("unchanged");
});

test("rejects a destination conflict without moving any legacy file", () => {
  writeFileSync(join(parent, ".env"), sqliteConfig);
  mkdirSync(product, { recursive: true });
  writeFileSync(join(product, "engram.db"), "different");
  expect(() => migrateLegacyEngramWorkspace()).toThrow("LEGACY_CONFLICT");
  expect(existsSync(join(parent, ".env"))).toBe(true);
});
```

Add no-legacy, symlink/reparse-point, ownership, user-owned `0755` auto-repair, orphan-sidecar, partial-rename rollback, and explicit-custom-root cases.

- [ ] **Step 2: Verify it fails**

Run: `bun test src/infrastructure/filesystem/product-home.test.ts src/infrastructure/filesystem/workspace-config.test.ts`

Expected: FAIL because no migration service exists.

- [ ] **Step 3: Implement bounded, reversible migration**

Allow only these legacy names: `.env`, `engram.db`, `engram.db-wal`, `engram.db-shm`, `.config-lock`. Inventory and validate every source/destination first. Reject any unsafe/foreign/linked/non-file candidate or destination conflict before creating/moving anything. Create/repair only the parent and product directories. Rename only the validated entries. If a later rename fails, reverse every completed rename and emit `LEGACY_MIGRATION_FAILED`. Do not call migration from `exists()`, `read()`, `revision()`, or read-only `open()`.

- [ ] **Step 4: Verify it passes**

Run: `bun test src/infrastructure/filesystem/product-home.test.ts src/infrastructure/filesystem/workspace-config.test.ts src/app/workspace.test.ts src/app/setup.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/filesystem/product-home.ts src/infrastructure/filesystem/product-home.test.ts src/infrastructure/filesystem/workspace-config.ts src/infrastructure/filesystem/workspace-config.test.ts src/app/workspace.test.ts src/app/setup.test.ts
git commit -m "feat: migrate legacy Engram storage safely"
```

### Task 3: Align setup, CLI, UI, and SDK wording

**Files:**
- Modify/test: `src/app/setup.ts`, `src/app/setup.test.ts`
- Modify/test: `src/interfaces/cli/help.ts`, `src/interfaces/cli/main.test.ts`
- Modify/test: `src/interfaces/tui/controller.ts`, `src/interfaces/tui/controller.test.ts`
- Modify/test: `src/index.ts`, `src/app/index.ts`, `src/index.test.ts`

**Interfaces:** Consumes Task 2 default `WorkspaceConfig`; produces only product-path output and intentionally chosen SDK exports.

- [ ] **Step 1: Write failing output assertions**

```ts
expect(io.output).toContain(join(home, ".forge614", "engram", ".env"));
expect(HELP).toContain("~/.forge614/engram/engram.db");
expect(defaultDatabasePath()).toBe(join(homedir(), ".forge614", "engram", "engram.db"));
```

Add a control-center assertion for the same database path and retain the test that assistant-list creates no storage.

- [ ] **Step 2: Verify failure**

Run: `bun test src/app/setup.test.ts src/interfaces/cli/main.test.ts src/interfaces/tui/controller.test.ts src/index.test.ts`

Expected: FAIL due to root-level wording.

- [ ] **Step 3: Implement minimal path copy updates**

Use `config.root` / `config.databasePath` in all messages; update help. Export only public path helpers required by current SDK consumers, not the internal migration service.

- [ ] **Step 4: Verify pass**

Run: `bun test src/app/setup.test.ts src/interfaces/cli/main.test.ts src/interfaces/tui/controller.test.ts src/index.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/setup.ts src/app/setup.test.ts src/interfaces/cli/help.ts src/interfaces/cli/main.test.ts src/interfaces/tui/controller.ts src/interfaces/tui/controller.test.ts src/index.ts src/app/index.ts src/index.test.ts
git commit -m "fix: report the Engram product-home paths"
```

### Task 4: Install into the product bin directory

**Files:**
- Modify/test: `scripts/install.sh`, `scripts/__tests__/install.sh.test.ts`
- Modify/test: `scripts/install.ps1`, `scripts/__tests__/install.ps1.test.ps1`
- Modify: `scripts/install-from-source.sh`
- Modify/test: `.github/workflows/release.yml`, `scripts/__tests__/release-windows-native-addon.test.ts`

**Interfaces:** Default location changes; `--bin-dir` / `-BinDir` remain deliberate overrides.

- [ ] **Step 1: Write failing installer fixture tests**

```ts
test("default Unix install uses the product bin and preserves Shell", async () => {
  mkdirSync(join(fakeHome, ".forge614", "shell"), { recursive: true });
  writeFileSync(join(fakeHome, ".forge614", "shell", "keep"), "shell");
  const result = await runInstaller([]);
  expect(result.exitCode).toBe(0);
  expect(existsSync(join(fakeHome, ".forge614", "engram", "bin", "forge614-engram"))).toBe(true);
  expect(readFileSync(join(fakeHome, ".forge614", "shell", "keep"), "utf8")).toBe("shell");
});
```

In PowerShell fixtures, set `USERPROFILE` and assert `$fixtureHome\\.forge614\\engram\\bin\\forge614-engram.exe`; preserve unrelated PATH entries. Assert help reports the new default. Keep release test coverage for both bootstrap assets.

- [ ] **Step 2: Verify failure**

Run: `bun test scripts/__tests__/install.sh.test.ts scripts/__tests__/release-windows-native-addon.test.ts`

Run on Windows: `pwsh -NoProfile -File scripts/__tests__/install.ps1.test.ps1`

Expected: FAIL because current defaults are `.local/bin` and `LOCALAPPDATA\\Forge614\\bin`.

- [ ] **Step 3: Implement the product-bin defaults**

Use `$HOME/.forge614/engram/bin` in both Unix scripts. Use `$env:USERPROFILE/.forge614/engram/bin` in PowerShell and reject absent `USERPROFILE`. Ensure Unix creates only missing Engram-owned directories with private modes, never recursive-chmods siblings. Preserve checksum verification, staging, force semantics, and bounded PATH markers. Update Windows release fixture environment to set `USERPROFILE`.

- [ ] **Step 4: Verify pass**

Run: `bun test scripts/__tests__/install.sh.test.ts scripts/__tests__/release-windows-native-addon.test.ts && bash -n scripts/install.sh scripts/install-from-source.sh`

Run on Windows: `pwsh -NoProfile -File scripts/__tests__/install.ps1.test.ps1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/install.sh scripts/install.ps1 scripts/install-from-source.sh scripts/__tests__/install.sh.test.ts scripts/__tests__/install.ps1.test.ps1 .github/workflows/release.yml scripts/__tests__/release-windows-native-addon.test.ts
git commit -m "feat: install Engram inside its product home"
```

### Task 5: Add exact assistant-integration removal plans

**Files:**
- Modify/test: `src/infrastructure/filesystem/private-files.ts`, `src/infrastructure/filesystem/private-files.test.ts`
- Modify/test: `src/infrastructure/assistants/configuration.ts`, `src/infrastructure/assistants/configuration.test.ts`
- Modify/test: `src/app/assistants.ts`, `src/app/assistants.test.ts`, `src/app/index.ts`

**Interfaces:** Produces `planAssistantRemoval(client, executable, options): ConfigurationPlan` and `applyAssistantRemoval(plan): ConfigurationResult`.

- [ ] **Step 1: Write failing exact-removal tests**

```ts
test.each(CLIENT_IDS)("removes only an exact managed %s entry", id => {
  applyAssistantConfiguration(planAssistantConfiguration(id, executable, options));
  const plan = planAssistantRemoval(id, executable, options);
  expect(applyAssistantRemoval(plan).ok).toBe(true);
  expect(readManagedConfiguration(id, options)).not.toContain("forge614-engram");
});

test("refuses a hand-edited Codex entry", () => {
  writeFileSync(codexConfig, '[mcp_servers.forge614-engram]\ncommand = "/other"\n');
  expect(() => planAssistantRemoval("codex", executable, options)).toThrow("CONFLICT");
});
```

Cover JSON/JSONC MCP, TOML, hooks, Cursor version retention, OpenCode plugin byte equality, absent no-op, changed-after-preview, malformed content, and unsafe paths.

- [ ] **Step 2: Verify failure**

Run: `bun test src/infrastructure/assistants/configuration.test.ts src/infrastructure/filesystem/private-files.test.ts`

Expected: FAIL because removal APIs do not exist.

- [ ] **Step 3: Implement symmetric guarded removal**

Add a guarded rewrite/delete primitive. Use JSONC edits to remove only the exact MCP and hook nodes; for Codex parse/validate then remove exactly the expected `[mcp_servers.forge614-engram]` table. Delete an OpenCode plugin only when its bytes equal `createOpenCodePlugin()`. Preserve backups for every changed pre-existing config. Keep empty user configuration files; never delete a whole assistant config.

- [ ] **Step 4: Verify pass**

Run: `bun test src/infrastructure/assistants/configuration.test.ts src/infrastructure/filesystem/private-files.test.ts src/app/assistants.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/filesystem/private-files.ts src/infrastructure/filesystem/private-files.test.ts src/infrastructure/assistants/configuration.ts src/infrastructure/assistants/configuration.test.ts src/app/assistants.ts src/app/assistants.test.ts src/app/index.ts
git commit -m "feat: plan safe removal of Engram assistant integrations"
```

### Task 6: Add guarded CLI uninstall with Atlas handoff

**Files:**
- Create/test: `src/app/uninstall.ts`, `src/app/uninstall.test.ts`
- Modify/test: `src/interfaces/cli/arguments.ts`, `src/interfaces/cli/commands.ts`, `src/interfaces/cli/help.ts`, `src/interfaces/cli/commands.test.ts`, `src/interfaces/cli/main.test.ts`

**Interfaces:** Produces `uninstallEngram(input, dependencies): Promise<UninstallResult>`; consumes exact removal plans and injected `runAtlasUninstall(command, args): Promise<number>`.

- [ ] **Step 1: Write failing orchestration tests**

```ts
test("Atlas failure leaves Engram untouched", async () => {
  makeEngramHome(); makeAtlasHome();
  const result = await uninstallEngram(
    { confirmation: "REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS" },
    { runAtlasUninstall: async () => 1, ...fixture },
  );
  expect(result.removed).toBe(false);
  expect(existsSync(engramHome)).toBe(true);
  expect(assistantRemovalWasApplied()).toBe(false);
});

test("wrong confirmation changes nothing", async () => {
  await expect(uninstallEngram({ confirmation: "yes" }, fixture)).rejects.toThrow("UNINSTALL_CONFIRMATION");
  expect(existsSync(engramHome)).toBe(true);
});
```

Add no-Atlas success, missing Atlas executable, exact Atlas command arguments, assistant-removal failure retaining product data, and parser rejection of unknown/duplicate flags.

- [ ] **Step 2: Verify failure**

Run: `bun test src/app/uninstall.test.ts src/interfaces/cli/commands.test.ts src/interfaces/cli/main.test.ts`

Expected: FAIL because command/service do not exist.

- [ ] **Step 3: Implement fail-closed deletion order**

Validate product and Atlas paths. Require the corresponding exact phrase. If Atlas exists, verify its executable and run exactly `uninstall --from forge614-engram --confirmed`; any launch/non-zero failure returns before Engram preflight. Preflight all assistant removals, apply them, remove only the installer-owned PATH entry, then remove only the verified resolved product directory. If any cleanup phase fails, retain the product directory; never remove the Forge614 parent, Shell, or Atlas directly.

- [ ] **Step 4: Verify pass**

Run: `bun test src/app/uninstall.test.ts src/interfaces/cli/commands.test.ts src/interfaces/cli/main.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/uninstall.ts src/app/uninstall.test.ts src/interfaces/cli/arguments.ts src/interfaces/cli/commands.ts src/interfaces/cli/help.ts src/interfaces/cli/commands.test.ts src/interfaces/cli/main.test.ts
git commit -m "feat: add guarded Engram uninstall"
```

### Task 7: Release preparation and documentation

**Files:**
- Modify: `package.json`, `README.md`, `docs/README.md`, `docs/en/**`, `docs/es/**`
- Test: all affected tests and release workflow regression test.

- [ ] **Step 1: Add release/version assertions where applicable**

```ts
expect(readFileSync("package.json", "utf8")).toContain('"version": "1.1.0"');
expect(README).toContain("releases/latest/download/install.sh");
expect(README).toContain("~/.forge614/engram/bin/forge614-engram");
```

- [ ] **Step 2: Verify all behavior before documentation**

Run: `bun test && bun run typecheck && git diff --check && bash -n scripts/install.sh scripts/install-from-source.sh`

Expected: PASS.

- [ ] **Step 3: Set 1.1.0 and update bilingual documentation**

Document product-home structure, safe migration, exact uninstall phrases, Atlas handoff, official curl/PowerShell installation, reopening terminal, `setup`, and tag-driven release process. State explicitly that end users do not clone the repository or install Bun/Node/Python/C++.

- [ ] **Step 4: Final verification**

Run: `bun test && bun run typecheck && git diff --check && bash -n scripts/install.sh scripts/install-from-source.sh`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json README.md docs
git commit -m "docs: prepare the 1.1.0 product-home release"
```

## Final release checklist

- [ ] Full Bun test suite, static typecheck, whitespace check, Unix syntax checks, and native Windows fixture tests are green.
- [ ] Review `git diff main...HEAD` for accidental changes outside Engram-owned scope.
- [ ] Merge to `main` only after macOS, Linux, and Windows GitHub workflows pass.
- [ ] Create/push annotated tag `v1.1.0`.
- [ ] Verify assets: six binaries, `SHA256SUMS`, `install.sh`, and `install.ps1`.
- [ ] In clean macOS/Linux and Windows profiles, run the public bootstrap command, open a new terminal, verify `forge614-engram --version`, run `setup`, and confirm every created Engram file is under `~/.forge614/engram`.

