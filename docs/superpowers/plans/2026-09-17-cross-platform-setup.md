# Cross-platform distribution and English setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distribute Forge614 Engram as verified standalone binaries for macOS, Linux, and Windows, and make `forge614-engram setup` safely configure the global store plus selected supported assistants in English.

**Architecture:** GitHub Actions builds the release binaries and a checksum manifest; small platform-native installers only select, download, verify, and atomically publish one binary. The compact setup terminal adapter owns keyboard navigation, while the application coordinator owns preview, preflight, and write ordering. Assistant modules own the supported identities and templates; infrastructure owns per-client paths and safe configuration publication.

**Tech Stack:** TypeScript, Bun 1.3.8, Bun compile targets, GitHub Actions, Bash, PowerShell, SQLite/FTS5, JSONC, TOML, MCP.

**Spec:** `docs/superpowers/specs/2026-09-17-cross-platform-setup-design.md`

## Global Constraints

- Build exactly `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `windows-x64.exe`, and `windows-arm64.exe` release artifacts plus `SHA256SUMS`.
- An end user must not need Bun, npm, Git, or a cloned repository; the checkout compiler remains a separate developer tool.
- The installer never creates `~/.forge614`, runs setup, detects assistants, changes PATH, or changes assistant configuration.
- `forge614-engram setup` is the one configuration entry point; its visible runtime text is English only.
- Setup writes nothing before its final keyboard-selected `Yes`; `No`, Escape, Ctrl+C, EOF, invalid input, non-TTY, stale plans, or failed preflight write nothing.
- Keep one global SQLite store. Do not add embeddings, an LLM, a cloud service, a second database, automatic synchronization, or a background service.
- Replace every managed `gemini-cli` identity with a real `antigravity` adapter, but never inspect, alter, or delete legacy Gemini user configuration.
- Antigravity MCP uses `~/.gemini/config/mcp_config.json` and the installed absolute executable with sole argument `mcp`; hooks stay unavailable unless their exact official schema is verified.
- All configuration writes preserve unrelated content where the format permits, use safe private backups, and verify publication; no destructive rollback.
- Keep `forge614-engram tui` and its existing behavior unchanged. It receives no features in this delivery.
- Tests use only disposable homes, files, paths, databases, and PostgreSQL fixtures. Never use a user configuration, database, service, credential, or `DATABASE_URL`.
- Keep tests colocated with the product file they cover; integration/e2e tests may live under the nearest `__tests__` directory and must never import another test.
- Do not commit or push: the repository owner performs those actions and documentation/Notion synchronization.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `src/modules/distribution/targets.ts` | Pure release target names, host selection, manifest parsing, and checksum validation inputs. |
| `src/modules/distribution/targets.test.ts` | Unit coverage for architecture selection and manifest parsing. |
| `scripts/install.sh` | End-user macOS/Linux downloader and atomic installer. |
| `scripts/install.ps1` | End-user Windows downloader and atomic installer. |
| `scripts/install-from-source.sh` | Explicit developer-only Bun checkout compiler retained from the current script. |
| `scripts/__tests__/install.sh.test.ts` | Disposable native installer tests using a local fixture release endpoint. |
| `scripts/__tests__/install.ps1.test.ps1` | Disposable Windows installer tests, run only in Windows CI. |
| `.github/workflows/verify.yml` | Non-publishing PR checks, including installer tests on their native OS. |
| `.github/workflows/release.yml` | Tag-only native binary build, checksum generation, artifact validation, and GitHub Release publication. |
| `src/modules/assistants/catalog.ts` | Supported identities, labels, coverage warnings, and the no-hooks Antigravity capability. |
| `src/modules/assistants/templates.ts` | Pure MCP/hook templates, including Antigravity’s MCP-only template. |
| `src/infrastructure/assistants/catalog.ts` | Antigravity executable detection and documented configuration path resolution. |
| `src/infrastructure/assistants/configuration.ts` | Safe Antigravity JSON configuration plan and removal of Gemini-only paths/branches. |
| `src/app/setup.ts` | Application-level setup preview, full preflight, and coordinated apply result. |
| `src/app/setup.test.ts` | Setup no-write, preview, stale-plan, multi-assistant, and partial-result tests. |
| `src/interfaces/terminal/selector.ts` | Reusable raw-terminal multi-select and Yes/No keyboard state machine. |
| `src/interfaces/terminal/selector.test.ts` | Colocated key-event and rendering tests without a real terminal. |
| `src/interfaces/terminal/setup.ts` | Compact interactive setup flow wired to the selector; maps interruption safely. |
| `src/interfaces/terminal/setup.test.ts` | Adapter tests for TTY refusal, EOF, escape, and no-write behavior. |
| `src/interfaces/cli/help.ts`, `arguments.ts`, `main.ts`, `commands.ts`, `src/shared/errors.ts`, affected terminal/MCP/app files | English-only user-visible messages while retaining codes and JSON keys. |
| `docs/superpowers/specs/2026-09-17-cross-platform-setup-design.md` | Approved design record; update only if implementation reveals a material official-platform constraint. |

### Task 1: Establish release target contracts

**Files:**
- Create: `src/modules/distribution/targets.ts`
- Create: `src/modules/distribution/targets.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `RELEASE_TARGETS`, `selectReleaseTarget(platform, architecture)`, `parseSha256Sums(text)`, and `verifyManifestEntry(manifest, artifact, digest)`.
- Consumed by installer fixture tests and release workflow artifact naming.

- [ ] **Step 1: Write the failing pure-contract tests**

```ts
import { expect, test } from "bun:test";
import { parseSha256Sums, selectReleaseTarget, verifyManifestEntry } from "./targets";

test("selects the exact standalone artifact for every supported host", () => {
  expect(selectReleaseTarget("darwin", "arm64")).toBe("forge614-engram-darwin-arm64");
  expect(selectReleaseTarget("win32", "x64")).toBe("forge614-engram-windows-x64.exe");
  expect(() => selectReleaseTarget("freebsd", "x64")).toThrow("Unsupported platform");
});

test("accepts one exact SHA256SUMS entry and rejects duplicate or malformed entries", () => {
  const manifest = parseSha256Sums("a".repeat(64) + "  forge614-engram-linux-x64\\n");
  expect(verifyManifestEntry(manifest, "forge614-engram-linux-x64", "a".repeat(64))).toBe(true);
  expect(() => parseSha256Sums("bad  binary\\n")).toThrow("SHA256SUMS");
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because the module does not exist**

Run: `bun test src/modules/distribution/targets.test.ts`

Expected: failure resolving `./targets`.

- [ ] **Step 3: Implement one pure, host-independent release target module**

```ts
export const RELEASE_TARGETS = [
  { platform: "darwin", architecture: "arm64", artifact: "forge614-engram-darwin-arm64" },
  { platform: "darwin", architecture: "x64", artifact: "forge614-engram-darwin-x64" },
  { platform: "linux", architecture: "x64", artifact: "forge614-engram-linux-x64" },
  { platform: "linux", architecture: "arm64", artifact: "forge614-engram-linux-arm64" },
  { platform: "win32", architecture: "x64", artifact: "forge614-engram-windows-x64.exe" },
  { platform: "win32", architecture: "arm64", artifact: "forge614-engram-windows-arm64.exe" },
] as const;
```

Normalize only known aliases (`x86_64` to `x64`, `aarch64` to `arm64`, `Windows_NT` to `win32`) at the installer boundary, not in application runtime. Require a 64-character lowercase hexadecimal checksum, reject duplicate artifact names, and never accept paths, whitespace-prefixed artifact names, or an artifact not in `RELEASE_TARGETS`.

- [ ] **Step 4: Add the module export only if it is part of the public SDK contract**

Do not export it from `src/index.ts` unless an existing product interface genuinely consumes it. Keep release mechanics internal by default.

- [ ] **Step 5: Run the focused test, typecheck, and whitespace validation**

Run: `bun test src/modules/distribution/targets.test.ts && bun run typecheck && git diff --check`

Expected: all commands succeed.

### Task 2: Separate developer compilation from verified end-user installation

**Files:**
- Modify: `scripts/install.sh`
- Create: `scripts/install-from-source.sh`
- Create: `scripts/install.ps1`
- Create: `scripts/__tests__/install.sh.test.ts`
- Create: `scripts/__tests__/install.ps1.test.ps1`

**Interfaces:**
- Consumes exact artifact names from Task 1 and GitHub Release `SHA256SUMS` format.
- Produces an executable at an explicitly selected user-owned `--bin-dir`; no other persistent write.
- Installer flags: `--version <tag>`, `--bin-dir <absolute-or-resolved-path>`, `--force`, and `--help`; an internal test-only release base override must be clearly rejected in normal release use and never documented to users.

- [ ] **Step 1: Write failing disposable Bash installer tests**

Create an ephemeral directory with a fake release layout containing a small executable fixture and a correct `SHA256SUMS`. Start an in-process/local HTTP fixture only for the test. Assert all of the following:

```ts
expect(result.exitCode).toBe(0);
expect(existsSync(join(destination, "forge614-engram"))).toBe(true);
expect(readFileSync(join(destination, "forge614-engram"), "utf8")).toBe(fixtureBytes);
expect(secondWithoutForce.exitCode).not.toBe(0);
expect(checksumMismatch.exitCode).not.toBe(0);
expect(existsSync(join(mismatchDestination, "forge614-engram"))).toBe(false);
expect(existsSync(join(fakeHome, ".forge614"))).toBe(false);
```

The test must pass a fixture-only endpoint through an explicitly named test environment variable, restore environment state, use an empty temporary HOME, and never download from GitHub.

- [ ] **Step 2: Run the Bash installer test and confirm it fails against the checkout compiler script**

Run: `bun test scripts/__tests__/install.sh.test.ts`

Expected: failure because the current installer requires Bun/Git and does not consume release binaries.

- [ ] **Step 3: Preserve the old checkout compiler as developer-only `install-from-source.sh`**

Move the current Bun/Git build behavior without changing its safety checks. Its help must say it is for repository developers, requires a prepared Bun checkout, and is not the user installation route. Translate all messages to English. It must not detect assistants or launch `tui`.

- [ ] **Step 4: Implement the end-user Bash downloader**

Implement `scripts/install.sh` with this concrete flow:

```bash
release_json_url="https://api.github.com/repos/${repo}/releases/${selector}"
# selector is "latest" or "tags/${version}" after a strict tag validation.
# Download SHA256SUMS and exactly one target artifact to a mktemp directory.
# Compare the selected manifest digest to shasum -a 256 output.
# chmod 755 a staged file and atomically publish it into --bin-dir.
```

Use `curl --fail --location --proto '=https' --tlsv1.2`; require `curl` and one available SHA-256 command (`shasum -a 256` or `sha256sum`). Map `Darwin/x86_64`, `Darwin/arm64`, `Linux/x86_64`, and `Linux/aarch64` to Task 1 artifact names. Refuse any other pair before downloading. Default to `$HOME/.local/bin`; require `--force` before replacement; create only the selected bin directory after checksum success; print the next command exactly as `forge614-engram setup`; never call it.

- [ ] **Step 5: Write the failing PowerShell cases before adding the Windows installer**

In `scripts/__tests__/install.ps1.test.ps1`, create fixture files and invoke `scripts/install.ps1` with `-ReleaseBaseUrl`, `-Version`, `-BinDir`, and a temporary `HOME`. Cover `AMD64`, `ARM64`, a checksum mismatch, and a pre-existing destination without `-Force`. Assert no output binary and no `.forge614` folder after failure.

- [ ] **Step 6: Implement `scripts/install.ps1` with equivalent Windows guarantees**

Use `Invoke-WebRequest` with HTTPS URLs, `Get-FileHash -Algorithm SHA256`, a GUID-named file in the destination directory, and `[System.IO.File]::Move` only after checksum verification. Map `AMD64` to `windows-x64.exe` and `ARM64` to `windows-arm64.exe`; reject others. Default to `$env:LOCALAPPDATA\\Forge614\\bin`; accept only `-Version`, `-BinDir`, `-Force`, `-Help`, and test-only `-ReleaseBaseUrl`. Print an English user-level PATH instruction but do not modify PATH. Print `forge614-engram setup` as the next step and do not run it.

- [ ] **Step 7: Run native installer tests and static script checks**

Run on macOS/Linux: `bun test scripts/__tests__/install.sh.test.ts && bash -n scripts/install.sh scripts/install-from-source.sh`

Run on Windows CI: `pwsh -NoProfile -File scripts/__tests__/install.ps1.test.ps1`

Expected: disposable fixtures pass; no test contacts GitHub or modifies a real user destination.

### Task 3: Add non-publishing verification and tag-only release workflows

**Files:**
- Create: `.github/workflows/verify.yml`
- Create: `.github/workflows/release.yml`
- Modify: `package.json` only if a script makes the build command reproducible

**Interfaces:**
- Consumes `bun build ./src/cli.ts --compile --target <Bun target> --outfile <artifact>`.
- Produces checks that validate every artifact name and manifest entry before release publication.

- [ ] **Step 1: Write workflow assertions as a shell fixture run before publishing is added**

Add a local CI validation command or checked-in shell block that fails if any expected artifact is missing, not executable where applicable, has an empty checksum, or has a manifest line count other than six:

```bash
for artifact in forge614-engram-darwin-arm64 forge614-engram-darwin-x64 \
  forge614-engram-linux-x64 forge614-engram-linux-arm64 \
  forge614-engram-windows-x64.exe forge614-engram-windows-arm64.exe; do
  test -s "dist/$artifact"
done
test "$(wc -l < dist/SHA256SUMS | tr -d ' ')" = 6
```

- [ ] **Step 2: Run the artifact validation against an intentionally incomplete local `dist` fixture**

Run: `bash -c '<the exact validation block>'`

Expected: failure identifying the missing artifact.

- [ ] **Step 3: Create `.github/workflows/verify.yml`**

Trigger on `pull_request` and normal pushes, never release publication. Use the pinned Bun version `1.3.8`. Run `bun install --frozen-lockfile --ignore-scripts`, `bun test`, `bun run typecheck`, `git diff --check`, native Bash installer tests on macOS/Linux, and PowerShell installer tests on Windows. Provision PostgreSQL only as an isolated CI service/fixture, never via repository secrets or `DATABASE_URL`.

- [ ] **Step 4: Create `.github/workflows/release.yml`**

Trigger only on tags matching `v*`. Build with the official Bun target flags `bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`, `bun-linux-arm64`, `bun-windows-x64`, and `bun-windows-arm64`. Use native runners where GitHub provides that host/architecture; if a target needs cross-compilation, explicitly pass its exact `--target=bun-...` and run the artifact’s available smoke check on a matching runner. Gather all six named files, generate `SHA256SUMS` from exactly those names, execute the validation block, upload artifacts, then create the GitHub Release. The publish job must depend on the completed verification/build jobs and use no release event for ordinary PRs.

- [ ] **Step 5: Validate workflow syntax and artifact naming locally**

Run: `rg -n "pull_request|push:|tags:|SHA256SUMS|forge614-engram-(darwin|linux|windows)" .github/workflows && git diff --check`

Expected: verification workflow has no publishing action; release workflow has one tag-only publication path and all six artifact names.

### Task 4: Replace Gemini CLI with an independent Antigravity adapter

**Files:**
- Modify: `src/modules/assistants/catalog.ts`
- Modify: `src/modules/assistants/catalog.test.ts`
- Modify: `src/modules/assistants/templates.ts`
- Modify: `src/modules/assistants/templates.test.ts`
- Modify: `src/infrastructure/assistants/catalog.ts`
- Modify: `src/infrastructure/assistants/catalog.test.ts`
- Modify: `src/infrastructure/assistants/configuration.ts`
- Modify: `src/infrastructure/assistants/configuration.test.ts`
- Modify: `src/app/assistants.test.ts`
- Modify: `src/app/__tests__/assistant-configuration.integration.test.ts`
- Modify: `src/interfaces/terminal/hooks.ts`
- Modify: `src/interfaces/terminal/hooks.test.ts`
- Modify: `src/interfaces/terminal/__tests__/assistant-hooks.e2e.test.ts`
- Modify: affected `src/interfaces/tui/**` tests only to replace the registry identity; do not add TUI behavior.

**Interfaces:**
- Produces `ClientId = "claude-code" | "codex" | "cursor" | "opencode" | "antigravity"`.
- `resolveAssistantPaths("antigravity", options)` returns `config: <home>/.gemini/config/mcp_config.json` and no managed hook file on macOS, Linux, and Windows.
- `hookConfiguration("antigravity", executable)` returns `{}` and `coverageWarnings` states that only MCP is available.

- [ ] **Step 1: Write failing Antigravity path, template, and safety tests**

```ts
test("Antigravity plans only its documented global MCP file", () => {
  const plan = planAssistantConfiguration("antigravity", executable, options);
  expect(plan.writes.map(write => write.path)).toEqual([
    join(home, ".gemini", "config", "mcp_config.json"),
  ]);
  expect(plan.warnings).toContain("Hooks are unavailable for Antigravity until a compatible official durable-memory event is verified.");
});

test("the managed registry no longer contains Gemini CLI", () => {
  expect(CLIENT_IDS).toEqual(["claude-code", "codex", "cursor", "opencode", "antigravity"]);
  expect(isClientId("gemini-cli")).toBe(false);
});
```

Use an executable created inside the temporary fixture and a temporary home. Also test that a legacy `<home>/.gemini/settings.json` is byte-for-byte untouched.

- [ ] **Step 2: Run the focused assistant tests and confirm the existing Gemini branches fail them**

Run: `bun test src/modules/assistants src/infrastructure/assistants src/app/assistants.test.ts src/app/__tests__/assistant-configuration.integration.test.ts`

Expected: failures because `antigravity` is not yet a `ClientId` and legacy Gemini paths are used.

- [ ] **Step 3: Implement the module identity and MCP-only template**

Replace the registry entry rather than aliasing it. Set label `Antigravity`; retain stable descriptor JSON fields. Add an Antigravity warning that configuration does not prove model compliance and that no supported automatic hook is configured. Do not manufacture a Gemini event, callback, hook JSON, or `memory-hook` template for Antigravity.

- [ ] **Step 4: Implement documented detection and safe JSON configuration planning**

Detect Antigravity’s documented `agy` executable from PATH, then from `<home>/.local/bin/agy` on macOS/Linux and `%LOCALAPPDATA%/agy/bin/agy.exe` on Windows. Extend path resolution and safe-file checks to Windows rather than rejecting the platform globally; test all configured client paths with temporary Windows-style inputs and run native configuration publication tests in Windows CI. Resolve Antigravity’s global config exactly to `<home>/.gemini/config/mcp_config.json`; create only the needed private `.gemini/config` directory at apply time through the existing guarded writer. Merge under `mcpServers["forge614-engram"]` with `{ command: executable, args: ["mcp"] }`. Preserve unrelated JSON keys, reject malformed/duplicate JSON, unsafe links, policy conflicts, ownership conflicts, and non-executable paths exactly as the existing adapters do.

- [ ] **Step 5: Remove Gemini behavior comprehensively without touching user files**

Replace every production and test registry occurrence of `gemini-cli`, Gemini executable detection, Gemini settings paths, Gemini hook special case, and Gemini help/generated text. Remove tests that assert a Gemini configuration is written; replace them with tests proving Antigravity writes only its own path. Do not add code that opens `.gemini/settings.json`, migrates it, deletes it, or uses it as a configuration source.

- [ ] **Step 6: Run a repository-wide managed-identity scan and focused tests**

Run: `rg -n -i "gemini-cli|Gemini CLI" src scripts package.json || true`

Expected: no production or test references. Then run:

`bun test src/modules/assistants src/infrastructure/assistants src/app/assistants.test.ts src/app/__tests__/assistant-configuration.integration.test.ts src/interfaces/terminal/hooks.test.ts src/interfaces/terminal/__tests__/assistant-hooks.e2e.test.ts`

Expected: all tests pass with Antigravity MCP-only coverage.

### Task 5: Build a testable keyboard selector for compact setup

**Files:**
- Create: `src/interfaces/terminal/selector.ts`
- Create: `src/interfaces/terminal/selector.test.ts`
- Modify: `src/interfaces/terminal/setup.ts`
- Modify: `src/interfaces/terminal/setup.test.ts`

**Interfaces:**
- Produces `MultiSelectSession<T>`, `ConfirmSession`, `decodeKey(bytes)`, and terminal rendering functions with no storage dependency.
- `MultiSelectSession` receives ordered `{ id, label, enabled }[]`, toggles with Space, moves with Up/Down, returns selected IDs only on Enter, and returns `null` on Escape/Ctrl+C/EOF.
- `ConfirmSession` starts at `Yes`, moves with Up/Down, returns `true` only on Enter while Yes is focused, and returns `false` on No/Escape/Ctrl+C/EOF.

- [ ] **Step 1: Write failing state-machine tests for exact key behavior**

```ts
const selector = new MultiSelectSession([
  { id: "codex", label: "Codex", enabled: true },
  { id: "antigravity", label: "Antigravity", enabled: true },
]);
selector.accept(" ");
selector.accept("ArrowDown");
selector.accept(" ");
expect(selector.accept("Enter")).toEqual(["codex", "antigravity"]);

const confirmation = new ConfirmSession();
expect(confirmation.render()).toContain("> Yes");
confirmation.accept("ArrowDown");
expect(confirmation.accept("Enter")).toBe(false);
```

Cover empty selection, disabled entries, repeated toggles, arrow wrap behavior, ANSI escape decoding, Ctrl+C, Escape, EOF, and a rendering assertion for the exact English prompt and labels.

- [ ] **Step 2: Run the selector test and confirm it fails before the module exists**

Run: `bun test src/interfaces/terminal/selector.test.ts`

Expected: failure resolving `./selector`.

- [ ] **Step 3: Implement a pure selector before raw terminal I/O**

Keep selection state and renderer pure. Use the display lines specified in the approved design, including `Detected assistants:`, checkboxes, `Up/Down to move · Space to select · Enter to continue`, and the two-line Yes/No confirmation. Do not accept typed `yes`, `no`, `y`, `n`, `s`, or `si` in this selector.

- [ ] **Step 4: Adapt `setupTerminal` to raw key input safely**

Use `stdin.setRawMode(true)` only after both streams are TTYs. Register interruption handlers once, restore raw mode/listeners/output state in `finally`, and translate Escape, Ctrl+C, closed stdin, and decoder failure to a cancelled result. Keep secret PostgreSQL input masked; do not echo its characters. Do not import SQLite, workspace, assistant configuration, or `process.exit` into `selector.ts`.

- [ ] **Step 5: Run focused selector and terminal adapter tests**

Run: `bun test src/interfaces/terminal/selector.test.ts src/interfaces/terminal/setup.test.ts`

Expected: key interaction tests pass and a non-TTY `setup` refuses before creating files.

### Task 6: Coordinate assistant preview, preflight, and apply inside setup

**Files:**
- Modify: `src/app/setup.ts`
- Modify: `src/app/setup.test.ts`
- Modify: `src/app/assistants.ts` only to export existing safe plan/preflight/apply contracts needed by setup
- Modify: `src/interfaces/terminal/setup.ts`
- Modify: `src/interfaces/terminal/setup.test.ts`
- Modify: `src/interfaces/cli/__tests__/cli.e2e.test.ts`

**Interfaces:**
- `SetupIO` becomes a narrow interaction contract: English `write`, masked `askSecret`, `selectAssistants(descriptors)`, and `confirmApply(summary)`.
- `runSetup(io, dependencies?)` returns `{ cancelled: true }` or `{ cancelled: false; storage: "sqlite"; assistants: ConfigurationResult[] }`.
- A selected assistant must have a discovered executable; unavailable selections are shown disabled and cannot produce a plan.

- [ ] **Step 1: Write failing application setup tests for the no-write boundary**

Use a fresh temporary `WorkspaceConfig`, temporary home, and fixture executable. Inject selection/confirmation responses and assert:

```ts
expect(await runSetup(noResponse, config)).toEqual({ cancelled: true });
expect(existsSync(config.root)).toBe(false);
expect(existsSync(antigravityConfig)).toBe(false);

const result = await runSetup(yesWithTwoAssistants, config);
expect(result.cancelled).toBe(false);
expect(result.assistants.map(item => item.ok)).toEqual([true, true]);
expect(readFileSync(antigravityConfig, "utf8")).toContain('"forge614-engram"');
```

Add isolated tests for: `No`; empty selection; assistant installed after an earlier setup run; selected malformed config; selected conflict; a plan changed after preview; PostgreSQL connection failure; and an injected second assistant publication failure. For every failure before Yes, assert config root, SQLite path, and all assistant config targets are absent/unchanged. For injected partial application after Yes, assert exact `appliedPaths`, `backupPaths`, `unverifiedPaths`, and error are reported; do not expect rollback.

- [ ] **Step 2: Run setup tests and confirm existing line-input flow cannot satisfy them**

Run: `bun test src/app/setup.test.ts src/interfaces/terminal/setup.test.ts src/interfaces/cli/__tests__/cli.e2e.test.ts`

Expected: failures for absent selector contract, Spanish prompts, and no assistant plan/application phase.

- [ ] **Step 3: Refactor setup into explicit planning and apply phases**

Perform this order exactly:

1. Validate existing workspace read-only and capture its config revision.
2. Ask PostgreSQL/reinforcement choices without changing anything.
3. Detect all five assistants read-only using the installed executable path.
4. Receive selected detected IDs; create every `ConfigurationPlan` and collect its public preview: label, MCP entry summary, hooks availability, allowed paths, warnings, and backup statement. Never display config bytes or secrets.
5. Render the complete preview; then use the keyboard Yes/No selector.
6. On `Yes`, recheck config revision, preflight every assistant plan, verify requested PostgreSQL connectivity, and recheck revision again.
7. Initialize/enable workspace capabilities only after those preflights pass.
8. Publish selected assistant plans sequentially through `applyAssistantConfiguration`; collect every returned `ConfigurationResult` and stop after a failed result, printing concrete paths/backups and no false success.

Any cancellation or preflight failure returns before step 7. Keep `workspace.init()`’s existing compatibility/no-replace checks intact. Never auto-select a project.

- [ ] **Step 4: Make re-runs explicit and idempotent**

Existing config/database remains read-only until final acceptance. Existing selected assistant entries that exactly match must preview as no-op and remain no-op after Yes. A newly installed assistant appears only after the user runs setup again, then selects it. Do not infer desired assistants from a previous run or automatically reconfigure all detected clients.

- [ ] **Step 5: Update terminal and CLI end-to-end tests**

Replace legacy typed confirmation expectations with raw-key/adapter simulations. Assert `setup` rejects flags and non-TTY calls with English error JSON and no writes. Assert EOF, Escape, and Ctrl+C set exit code 130 only through the terminal adapter, leaving all state untouched.

- [ ] **Step 6: Run the full setup subset and typecheck**

Run: `bun test src/app/setup.test.ts src/interfaces/terminal/selector.test.ts src/interfaces/terminal/setup.test.ts src/interfaces/cli/__tests__/cli.e2e.test.ts && bun run typecheck`

Expected: all tests pass, including multi-select, no-write, stale-plan, and partial-application reporting.

### Task 7: Convert all runtime product copy to English

**Files:**
- Modify: `src/interfaces/cli/help.ts`
- Modify: `src/interfaces/cli/arguments.ts`
- Modify: `src/interfaces/cli/main.ts`
- Modify: `src/interfaces/cli/commands.ts`
- Modify: `src/shared/errors.ts`
- Modify: affected `src/app/**`, `src/infrastructure/**`, `src/interfaces/mcp/**`, `src/interfaces/terminal/**`, and `src/interfaces/tui/**` files that produce user-visible text
- Modify: colocated tests that assert user-visible strings

**Interfaces:**
- Error `code` values and machine-readable JSON keys remain unchanged.
- Every human-facing message emitted by the binary, installer, setup, TUI, generated configuration preview, and assistant instruction is English.

- [ ] **Step 1: Write failing English contract tests at public boundaries**

Add assertions such as:

```ts
expect(run(dir, "help").stdout.toString()).toContain("Interactive setup; changes are applied only after confirmation.");
expect(JSON.parse(run(dir, "search", "--limit", "zero").stderr.toString())).toMatchObject({
  code: "INVALID_INPUT",
  error: expect.stringContaining("must be a positive integer"),
});
```

Add setup-render assertions for `Detected assistants:`, the visual Yes/No selection, `Apply this configuration?`, and an English cancellation notice. Preserve JSON field names such as `projectId`, `storage`, `error`, and `code` exactly.

- [ ] **Step 2: Run the public-boundary tests and record current Spanish failures**

Run: `bun test src/interfaces/cli src/interfaces/terminal src/app/setup.test.ts`

Expected: string assertion failures only; behavior remains unchanged.

- [ ] **Step 3: Translate product copy systematically**

Translate all messages read by a user, including CLI help, parser validation, top-level fallback error, setup, sync, workspace/configuration errors, MCP tool errors/instructions, terminal hook output, TUI labels/statuses, and installer messages. Keep explicit technical terms where useful (`SQLite`, `FTS5`, `MCP`, `PostgreSQL`) and explain them plainly in surrounding text. Do not translate protocol names, client IDs, error codes, command names, JSON keys, database schema names, or filesystem paths.

- [ ] **Step 4: Prove there is no remaining Spanish runtime copy**

Run a Unicode and known-phrase scan over product sources, then inspect every match:

`rg -n "[áéíóúñ¿¡]|Comando|configuración|recuerdo|ejecuta|requiere|desconocido|sincronización" src scripts package.json`

Expected: no human-facing Spanish product output. False positives only in immutable identifiers/comments must be removed or documented in the review notes; no Spanish runtime string may remain.

- [ ] **Step 5: Run the complete non-PostgreSQL suite and typecheck**

Run: `bun test --timeout 30000 && bun run typecheck && git diff --check`

Expected: all available isolated tests pass. If PostgreSQL integration needs binaries, use newly provisioned disposable binaries or CI; never point tests at a user service.

### Task 8: Verify release packaging, safety invariants, and handoff

**Files:**
- Modify: affected test files from Tasks 1–7 only when verification exposes a legitimate missing case
- Modify: `docs/superpowers/specs/2026-09-17-cross-platform-setup-design.md` only if implementation discovers an official incompatibility that changes the approved design

**Interfaces:**
- Consumes all prior task contracts.
- Produces evidence for user review and a documentation/Notion handoff list; it creates no commit or release.

- [ ] **Step 1: Run focused packaging and identity scans**

Run:

```bash
rg -n -i "gemini-cli|Gemini CLI|connect antigravity" src scripts package.json .github || true
rg -n "forge614-engram tui" scripts/install.sh scripts/install.ps1 scripts/install-from-source.sh || true
rg -n "forge614-engram setup" scripts/install.sh scripts/install.ps1
```

Expected: no Gemini managed identity, no special Antigravity connection command, no installer TUI offer, and both installers direct the user to `forge614-engram setup`.

- [ ] **Step 2: Build each Bun target in a disposable output directory**

Run the six documented `bun build --compile --target=bun-darwin-arm64|bun-darwin-x64|bun-linux-x64|bun-linux-arm64|bun-windows-x64|bun-windows-arm64 --outfile <temporary path>` commands. Assert the output file names match the release matrix. Run `--version` only on the host-compatible artifact; do not execute cross-platform binaries locally.

- [ ] **Step 3: Validate installer atomicity one final time**

Run Bash fixture tests locally and PowerShell fixture tests in Windows CI. Inspect test destination directories after forced checksum mismatch, network failure, unsupported platform, and pre-existing command failure. They must contain neither a published binary nor `.forge614`.

- [ ] **Step 4: Run complete verification with isolated PostgreSQL provisioning**

Run: `bun test && bun run typecheck && git diff --check`

Use freshly provisioned disposable PostgreSQL binaries only if test coverage requires them. Record the exact command and pass/fail counts. If the local environment lacks disposable binaries, run the non-PostgreSQL suite, verify release/package checks, and leave the final PostgreSQL path to CI rather than substituting a user service.

- [ ] **Step 5: Perform code review against the approved spec**

Check each requirement: six checksummed release artifacts; tag-only publication; no installer side effects; English-only runtime; exactly five assistant identities; Antigravity MCP-only documented path; preview/preflight before all writes; keyboard Yes/No; precise partial-result reporting; unchanged one-DB/FTS5/project contracts; and no new TUI feature/removal.

- [ ] **Step 6: Prepare the documentation handoff without editing bilingual docs automatically**

Provide the documentation agent a precise change list: new installation commands per OS, release checksum behavior, `forge614-engram setup` selector/screens, Antigravity MCP-only limitations and path, Gemini support removal without user-file changes, and the temporary status of `tui`. Explicitly ask that agent to reconcile the existing bilingual-doc policy with the current English-only runtime policy before modifying or deleting any `docs/es` content or Notion page.

## Plan self-review

**Spec coverage:** Distribution is Tasks 1–3; Antigravity replacement is Task 4; keyboard setup, preview/preflight, idempotent rerun, and partial reporting are Tasks 5–6; English runtime is Task 7; safety, matrix verification, workflow release constraints, and documentation handoff are Task 8. The one global SQLite store, no cloud/embeddings, and no TUI change are global constraints enforced in every task.

**Completeness scan:** Every implementation activity has an exact owning task, file location, test command, and acceptance result. Bun’s target names and Antigravity’s documented `agy` locations are recorded explicitly above.

**Type consistency:** `ClientId`, `ConfigurationPlan`, `ConfigurationResult`, `SetupIO`, selector result types, release artifact names, and installer flags are declared once and reused with the same spelling throughout the plan.
