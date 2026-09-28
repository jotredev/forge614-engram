# v1.0.0 Release Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a safe public `v1.0.0-rc.1` that an external macOS/Linux user can install with one `curl` command, without replacing the future stable latest release.

**Architecture:** The version embedded in the executable comes from `package.json`. GitHub Actions builds each platform artifact, validates the checksums, and publishes only tag-triggered releases. Tags with a suffix such as `-rc.1` must be explicitly marked as prereleases so GitHub's `latest` endpoint stays reserved for stable releases.

**Tech Stack:** TypeScript, Bun, Bash, GitHub Actions, GitHub Releases.

**Spec:** User request in this conversation: test the real external-user `curl` installation flow before stable v1.0.0.

## Global Constraints

- Keep `main` unchanged until the release-candidate checks pass.
- Use a public GitHub Release asset plus `SHA256SUMS`; never bypass integrity verification.
- A `-rc` tag must not become GitHub's stable latest release.
- Verify with a clean temporary home directory, not the developer's installed copy.
- Keep the existing stable-release documentation unchanged until the candidate has been accepted as `v1.0.0`.

## Review Focus

- A prerelease tag must have GitHub's prerelease flag, otherwise a plain installer command could fetch it as latest.
- The executable version must match the release candidate rather than the stale `0.5.0` value.
- The external installer must succeed with the exact one-command pipe a user receives.
- The installed command must resolve after adding its private bin directory to `PATH`.

---

### Task 1: Prevent release candidates from becoming stable latest

**Files:**
- Modify: `.github/workflows/release.yml:213-223`
- Modify: `scripts/__tests__/release-windows-native-addon.test.ts:28-42`

- [ ] **Step 1: Write the failing test**

Add an assertion that the release workflow contains a conditional that detects a hyphenated tag and passes `--prerelease` to `gh release create`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test scripts/__tests__/release-windows-native-addon.test.ts`

Expected: FAIL because the existing workflow has no prerelease conditional.

- [ ] **Step 3: Write the minimal implementation**

Build a `release_flags` Bash array. Add `--prerelease` only when `GITHUB_REF_NAME` contains `-`, then expand it in the existing `gh release create` command.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test scripts/__tests__/release-windows-native-addon.test.ts`

Expected: PASS.

### Task 2: Embed the release-candidate version

**Files:**
- Modify: `package.json:3`

- [ ] **Step 1: Update version identity**

Set the package version from `0.5.0` to `1.0.0-rc.1`. The public documentation remains at the current stable label until the candidate is accepted and the stable `v1.0.0` release is prepared.

- [ ] **Step 2: Verify the command version**

Run: `bun src/cli.ts --version`

Expected: `forge614-engram 1.0.0-rc.1`.

### Task 3: Publish and verify the external installation path

**Files:**
- No source files after Tasks 1–2.

- [ ] **Step 1: Run full local checks**

Run: `bun test && bun run typecheck && git diff --check`

Expected: all pass.

- [ ] **Step 2: Merge the preparation branch and tag it**

Merge only after checks pass, push `v1.0.0-rc.1`, then wait for the tag workflow to create the prerelease with validated assets.

- [ ] **Step 3: Verify from an empty home directory**

Run the exact public command:

```bash
curl -fsSL https://raw.githubusercontent.com/jotredev/forge614-engram/main/scripts/install.sh | bash -s -- --version v1.0.0-rc.1
```

with `HOME` set to an empty temporary directory. Confirm the downloaded executable reports `forge614-engram 1.0.0-rc.1`.
