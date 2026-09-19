# Native Windows Reparse-Point Guard Design

## Goal

Replace the repeated PowerShell-based Windows reparse-point check with a tiny native Windows Node-API addon, embedded in each standalone Windows executable. Normal configuration paths must remain fast; symbolic links, junctions, volume mount points, and every other `FILE_ATTRIBUTE_REPARSE_POINT` must be rejected before configuration writes.

## Decision

The TypeScript application calls a narrow `hasReparsePoint(path): boolean` interface only on Windows. Its Windows implementation is a Node-API addon that calls `GetFileAttributesW` from `Kernel32.dll` using an absolute UTF-16 path. It returns `true` when the API reports `FILE_ATTRIBUTE_REPARSE_POINT`; it throws on any API failure. TypeScript converts every addon-load, API, or unexpected result failure into `UNSAFE_PATH`, so it fails closed.

The addon is compiled separately for Windows x64 and ARM64, directly required by a Windows-only TypeScript loader, and embedded by Bun in the corresponding `--compile` executable. macOS and Linux retain the existing `lstat` and permission checks and never load a Windows binary.

## Security Rules

- A reparse point at the target or any existing ancestor is rejected.
- An unreadable path, addon-loading problem, unsupported addon result, or Windows API error is rejected; it is never treated as safe.
- The addon receives only a string parameter through Node-API. It never starts a shell, interprets a command, reads environment variables, or writes files.
- TypeScript still retains `lstat`, `O_NOFOLLOW`, ownership, inode, backup, and post-publication verification protections.
- No result is cached across filesystem operations. Each `assertSafePath` calls the native check again for its currently existing ancestors.

## Build and Release Rules

- The repository stores addon source, not generated `.node` binaries.
- Windows x64 and Windows ARM64 release matrix jobs build the matching addon before `bun build --compile`.
- Each Windows standalone build must smoke-test `--help` and run a native reparse guard test after building the addon.
- Unix release artifacts must not include or load the addon.
- The resulting user download remains one `forge614-engram*.exe` file; no runtime compiler, Bun, Node.js, PowerShell, administrator right, or secondary user-visible helper is needed.

## Tests

- A Windows-only test proves a normal temporary path is accepted quickly.
- Windows-only tests prove file links, directory junctions, and volume mount-point ancestors are rejected.
- A test seam proves an addon failure is converted to `UNSAFE_PATH`.
- CI builds the native addon and executes the Windows-only tests on `windows-latest`.
- The release workflow builds both Windows architecture variants with their matching embedded addon.

## Non-goals

- Do not use Bun FFI: Bun documents it as experimental for production use.
- Do not use `fsutil`: it can require administrator privileges.
- Do not change user-facing setup, MCP configuration locations, installers, storage, or public documentation in this task. Public bilingual documentation is updated only after all CI jobs pass.
