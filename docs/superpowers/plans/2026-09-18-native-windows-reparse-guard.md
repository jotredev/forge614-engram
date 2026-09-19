# Native Windows Reparse-Point Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PowerShell reparse-point checks with an embedded, native Windows guard while preserving fail-closed configuration safety.

**Architecture:** A small Windows Node-API addon calls `GetFileAttributesW`; a TypeScript loader exposes its boolean result to `private-files.ts`. The release matrix builds the matching addon before compiling each Windows standalone binary. Unix never imports it.

**Tech Stack:** TypeScript, Bun 1.3.8/1.3.10, Node-API, C/C++, Windows Kernel32 API, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-18-native-windows-reparse-guard-design.md`

## Global Constraints

- Retain TypeScript/Bun as the product runtime; the addon is Windows-only implementation detail.
- Reject all failures as `UNSAFE_PATH`; never downgrade a failed check to safe.
- Do not invoke PowerShell, `fsutil`, a shell, or runtime-installed dependencies.
- Embed the architecture-matching addon in the standalone Windows executable.
- Do not edit public documentation until all CI jobs pass.

---

### Task 1: Windows Native Guard Addon and Loader

**Files:**
- Create: `native/windows-reparse-guard/addon.cc`
- Create: `native/windows-reparse-guard/binding.gyp`
- Create: `src/infrastructure/filesystem/windows-reparse-guard.ts`
- Test: `src/infrastructure/filesystem/windows-reparse-guard.test.ts`

**Interfaces:**
- Produces `hasWindowsReparsePoint(path: string): boolean`.
- Throws an `Error` when `GetFileAttributesW` returns `INVALID_FILE_ATTRIBUTES` or Node-API conversion fails.

- [ ] **Step 1: Write the failing loader test**

```ts
test("Windows guard turns a native checker failure into an error", () => {
  expect(() => checkWindowsReparsePoint("C:\\safe", () => { throw new Error("native"); })).toThrow();
});
```

- [ ] **Step 2: Run it to verify RED**

Run: `bun test src/infrastructure/filesystem/windows-reparse-guard.test.ts`

Expected: FAIL because the loader does not exist.

- [ ] **Step 3: Implement the smallest loader and addon**

```cpp
DWORD attributes = GetFileAttributesW(path);
if (attributes == INVALID_FILE_ATTRIBUTES) napi_throw_error(env, nullptr, "GetFileAttributesW failed");
return (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
```

Use a direct Node-API string argument, `GetFileAttributesW`, and a boolean return. Do not expose any write function.

- [ ] **Step 4: Run loader tests and native addon build**

Run: `bun test src/infrastructure/filesystem/windows-reparse-guard.test.ts`

Expected: PASS locally for platform-independent loader behavior; Windows-native execution is covered in Task 3.

### Task 2: Replace PowerShell Guard with the Native Interface

**Files:**
- Modify: `src/infrastructure/filesystem/private-files.ts`
- Modify: `src/infrastructure/filesystem/private-files.test.ts`

**Interfaces:**
- Consumes `hasWindowsReparsePoint(path): boolean`.
- Keeps `assertSafePath(path, platform?)` public signature unchanged.

- [ ] **Step 1: Write failing fail-closed integration tests**

```ts
test("a native guard exception rejects the path", () => {
  expect(() => assertSafePath(path, "win32", () => { throw new Error("native"); }))
    .toThrow(expect.objectContaining({ code: "UNSAFE_PATH" }));
});
```

- [ ] **Step 2: Run it to verify RED**

Run: `bun test src/infrastructure/filesystem/private-files.test.ts`

Expected: FAIL because no injectable checker/fail-closed bridge exists.

- [ ] **Step 3: Implement minimal replacement**

Remove `node:child_process`, PowerShell script constants, environment transport, and timeout. For every existing path entry on native Windows, call the new checker and reject `true` or any thrown error as `UNSAFE_PATH`.

- [ ] **Step 4: Run focused tests**

Run: `bun test src/infrastructure/filesystem/private-files.test.ts src/infrastructure/assistants/windows-publication.test.ts`

Expected: Unix tests pass and native Windows cases remain intentionally skipped outside Windows.

### Task 3: Native Windows Tests and CI Build

**Files:**
- Modify: `src/infrastructure/filesystem/private-files.test.ts`
- Modify: `.github/workflows/verify.yml`
- Create: `scripts/build-windows-reparse-addon.ps1`

**Interfaces:**
- The PowerShell build script creates the architecture-specific `.node` addon from checked-in source before Windows tests.

- [ ] **Step 1: Extend the native Windows test before CI changes**

```ts
nativeWindows("normal configuration path is accepted without shell startup", () => {
  guardedWrite({ path, before: null, after: "new", kind: "config" }, noop, noop);
  expect(readSafeFile(path)).toBe("new");
});
```

- [ ] **Step 2: Verify it fails until the addon is built**

Run on Windows CI: `bun test src/infrastructure/filesystem/private-files.test.ts`

Expected: FAIL closed because the addon is unavailable.

- [ ] **Step 3: Build addon before Windows tests**

Add a Windows CI step that installs/uses the preinstalled Visual Studio build tools, invokes `scripts/build-windows-reparse-addon.ps1`, and runs all existing native hostile-path tests.

- [ ] **Step 4: Verify the native job**

Run: Windows GitHub Actions `Verify` job.

Expected: normal path, Antigravity publication, link, junction, and mount-point cases pass.

### Task 4: Embed Addons in Windows Release Artifacts

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `.gitignore` if generated addon paths need explicit exclusion

**Interfaces:**
- Windows build jobs compile the correct addon before `bun build --compile`.

- [ ] **Step 1: Add a failing release build expectation**

Require the Windows release job to compile and import its corresponding addon before smoke-testing the executable.

- [ ] **Step 2: Implement matching-architecture build steps**

Use the Windows matrix architecture to build the matching `.node` source artifact and make its direct `require` visible to Bun’s compiler.

- [ ] **Step 3: Verify release workflow syntax and Windows artifact smoke test**

Run: a tag-like workflow dispatch or isolated Windows build check.

Expected: each Windows executable runs `--help`; the final archived artifact remains a single `.exe`.

### Task 5: Final Verification and Public Documentation Handoff

**Files:**
- Modify only after green: `docs/en/*`, `docs/es/*`, and their Notion counterparts through the user’s documentation workflow.

- [ ] **Step 1: Run full verification**

Run: `bun test && bun run typecheck && git diff --check`.

- [ ] **Step 2: Confirm native CI**

Run: GitHub Actions `Verify` on Ubuntu, macOS, and Windows.

Expected: all jobs green.

- [ ] **Step 3: Give the user the bilingual documentation prompt**

Only after green, describe the native Windows protection in plain language and explain that it is embedded inside the one-file executable.
