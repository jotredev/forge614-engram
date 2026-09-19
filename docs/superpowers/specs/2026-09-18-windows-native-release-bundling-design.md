# Windows Native Release Bundling Design

## Purpose

Forge614 Engram must distribute a single Windows executable for each supported
Windows architecture. A person installing it must not need Bun, Node.js,
Python, Visual Studio, a C++ compiler, or a separate native-addon file.

The executable must retain the existing Windows reparse-point protection. That
protection is supplied by a small Node-API addon written in C++ and loaded by a
direct `require()` from `src/infrastructure/filesystem/windows-reparse-guard.ts`.

## Current State

The regular verification workflow builds and exercises the x64 addon on a
Windows runner. The release workflow compiles Windows x64 and ARM64 executables
but does not build the addon first. Its Windows smoke check only runs `--help`,
which cannot prove that the compiled executable embeds and loads the addon.

## Chosen Design

Each Windows entry in the release build matrix supplies its addon architecture:

- `windows-latest` builds the x64 addon and `forge614-engram-windows-x64.exe`.
- `windows-11-arm` builds the ARM64 addon and
  `forge614-engram-windows-arm64.exe`.

Before `bun build --compile`, each Windows runner installs the build-only
requirements and invokes `scripts/build-windows-reparse-addon.ps1` with the
matrix architecture. The script replaces the repository's zero-byte bundling
marker with the native binary for that architecture.

Bun's standalone-executable compiler embeds a `.node` addon when it is loaded
through a direct literal `require()`. The existing loader already uses that
form. The resulting executable therefore contains the matching addon; no
`windows_reparse_guard.node` is distributed beside it.

After compilation, the Windows release job executes the completed `.exe` from
an isolated temporary user profile using `assistant-list`. That command plans
the supported assistant configurations without writing them. Planning checks
the existing parents of configuration paths, which invokes the Windows
reparse-point loader. This verifies the executable can load the embedded addon
outside the source repository without initializing user storage.

The release workflow retains its current `--help` smoke check. The new check is
additional evidence that the security dependency is usable from the packaged
program.

## Build-only and User Requirements

Node.js, Python, node-gyp, and Visual Studio C++ Build Tools exist only on the
temporary GitHub Windows runner that compiles the addon. Bun is also a build
tool in that runner. End users download one architecture-specific executable
and run `forge614-engram setup`; no build tool or separate addon is installed
on their computer.

## Verification

Tests will cover the release workflow contract, including:

1. Each Windows matrix row declares the matching addon architecture.
2. Windows installs Node.js and Python, builds the addon, and does so before
   standalone compilation.
3. The build script receives `x64` or `arm64` exactly as declared by the row.
4. The generated Windows executable is tested from a temporary profile with
   no source-tree dependency and loads the addon through `assistant-list`.
5. Non-Windows release entries do not receive Windows-only build steps.

The existing x64 verification workflow continues to test normal paths and
rejections for symbolic links, junctions, and mount points. The release jobs
prove that both Windows release executables embed and load their respective
addon. They do not claim that every Windows ARM64 reparse-point form is tested
unless an ARM64 runner runs those dedicated tests.

The release workflow also gains a manual validation mode. It builds, verifies,
and uploads the same artifacts from the selected tag or branch, but skips
GitHub Release publication unless the workflow was triggered by a `v*` tag.
This permits verification of the whole packaging path before a stable release
tag is created.

## Failure Behavior

If addon compilation fails, the release job stops before producing a Windows
executable. If the addon is absent, empty, built for the wrong architecture, or
cannot load from the executable, the packaged-program smoke test fails. The
release assembly and publishing jobs cannot run until all build jobs succeed.

## Scope Boundaries

This delivery changes release construction and verification only. It does not
change the installer command, assistant setup flow, database behavior, MCP
protocol, Forge614 Shell, or public product documentation. Documentation is
updated after the workflow proves the implementation on GitHub Actions.
