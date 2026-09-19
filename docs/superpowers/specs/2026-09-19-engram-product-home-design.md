# Forge614 Engram product-home migration

## Intent

Forge614 Engram must behave as one product in the Forge614 family. Its executable,
configuration, SQLite database, lock files, and SQLite auxiliary files belong inside
`~/.forge614/engram/`, never beside a sibling product such as Forge614 Shell or
Forge614 Atlas.

The change must be safe for a person upgrading from the previous layout. A person
must never lose memories, have an existing database overwritten, or have a different
Forge614 product changed or removed.

## Success criteria

- A normal macOS/Linux installation puts the command at
  `~/.forge614/engram/bin/forge614-engram`.
- A normal Windows installation puts the command at
  `%USERPROFILE%\\.forge614\\engram\\bin\\forge614-engram.exe`.
- The default Engram workspace is `~/.forge614/engram/` on every supported platform.
- The configuration is `~/.forge614/engram/.env` and the local SQLite database is
  `~/.forge614/engram/engram.db`.
- Existing legacy Engram data is migrated only when it is safe to do so, without
  touching `~/.forge614/shell/`, `~/.forge614/atlas/`, or unknown sibling content.
- An unsafe or ambiguous filesystem state stops with an actionable error and makes no
  destructive change.
- `forge614-engram uninstall` removes only Engram-owned installation and assistant
  configuration. Atlas is handled only through its own confirmed uninstall command.
- Automated tests cover normal installation, migration, rejection cases, uninstall,
  and release packaging on macOS/Linux and Windows fixtures.

## Product-home layout

The parent directory is a shared Forge614 container; it is not Engram's directory.

```text
~/.forge614/
  shell/                  # owned by Forge614 Shell
  atlas/                  # owned by Forge614 Atlas
  engram/                 # owned by Forge614 Engram
    bin/
      forge614-engram
    .env
    engram.db
    engram.db-wal
    engram.db-shm
    .config-lock
```

On Windows, the equivalent parent is `%USERPROFILE%\\.forge614` and the executable
has the `.exe` suffix. The product-relative layout is otherwise the same.

The parent may already contain any number of sibling products. Engram may create or
repair the parent directory only when it is an ordinary directory owned by the current
user. It never replaces, renames, enumerates for deletion, or changes a sibling.

`~/.forge614` and `~/.forge614/engram` use private owner-only directory permissions
where the platform supports them. Existing ordinary directories owned by the current
user are automatically repaired to the required privacy mode. Symbolic links,
reparse points, non-directories, foreign-owned paths, and paths that cannot be
verified fail closed.

Engram-owned sensitive files use owner-only file permissions. This is automatic; a
person installing Engram must not need to run `chmod` themselves.

## Runtime paths and public API

The default path helpers and `WorkspaceConfig()` default constructor resolve to the
Engram product directory rather than the Forge614 parent. A caller that explicitly
passes an absolute custom workspace directory retains that explicit choice; this
change does not reinterpret custom SDK paths.

All runtime entry points use the same product-home resolver:

- `MemoryStore()` default database path;
- `MemoryWorkspace()` and setup;
- CLI help and setup output;
- terminal and TUI controllers;
- assistant executable discovery;
- SQLite database opening and safety checks.

No operation should accidentally create a database at `~/.forge614/engram.db` after
the migration is released.

## Legacy layout migration

The previous product layout stored these exact Engram-owned entries directly in the
Forge614 parent:

```text
~/.forge614/.env
~/.forge614/engram.db
~/.forge614/engram.db-wal
~/.forge614/engram.db-shm
~/.forge614/.config-lock
```

Migration runs only from an explicit state-changing Engram action (`setup`, `init`,
or another operation that initializes the workspace). Read-only commands do not
move files. It follows this sequence:

1. Validate the Forge614 parent and every legacy candidate as safe, ordinary,
   current-user-owned paths.
2. If no legacy Engram entries exist, initialize the new product home normally.
3. If the legacy configuration or database exists, validate that the new product home
   does not already contain a conflicting configuration, database, lock, or sidecar.
4. Create and verify `~/.forge614/engram` privately.
5. Move only the known legacy entries into the product home. The SQLite database and
   its `-wal` / `-shm` companions move as one set while no database handle is open.
6. Validate the moved configuration and open the moved database using the normal
   safety checks.

If an expected item is missing, malformed, linked, foreign-owned, conflicts with an
existing destination, or cannot be moved atomically, migration stops before it
overwrites or deletes anything. The error tells the person which path needs manual
attention. Unknown files directly in `~/.forge614` remain untouched.

The old executable location is not used as proof that data can be deleted. Installation
publishes the new executable and PATH entry. A previous executable is removed only by
the dedicated Engram uninstall/legacy-cleanup rules after ownership can be verified;
otherwise it is left in place with clear guidance. This prevents an installer from
deleting a user-created file merely because it has Engram's old name.

## Installation and PATH publication

Both bootstrap installers remain release assets named `install.sh` and `install.ps1`.
They continue to download the selected release's platform-specific binary and verify
it against `SHA256SUMS` before publishing it.

Their default bin directory changes to the product home:

- macOS/Linux: `$HOME/.forge614/engram/bin`.
- Windows: `$env:USERPROFILE/.forge614/engram/bin`.

The Unix installer writes only its bounded `forge614-engram PATH` marker in the shell
startup file. It replaces its own valid marker exactly once and preserves unrelated
startup-file content. The Windows installer adds only the product bin directory to
the user PATH and never removes unrelated PATH entries.

`--bin-dir` / `-BinDir` remain explicit advanced overrides for fixtures and users
who intentionally choose a different command location. They do not change the
workspace data location.

## Assistant integration and uninstall

The `uninstall` command is a deliberate destructive action and therefore requires an
exact confirmation phrase. Before deleting anything it prepares and validates removal
plans for only the MCP entries, hooks, and plugin files that Engram originally owns.
Unrelated assistant configuration must be preserved byte-for-byte where possible.

Without Atlas, the required phrase is:

```text
REMOVE FORGE614-ENGRAM
```

If `~/.forge614/atlas` exists, Atlas depends on Engram. The required phrase is:

```text
REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS
```

After that confirmation, Engram invokes exactly:

```text
~/.forge614/atlas/bin/forge614-atlas uninstall --from forge614-engram --confirmed
```

If Atlas's executable is missing or its command fails, Engram stops and deletes
nothing. If it succeeds, Engram removes its own assistant entries, its owned PATH
marker/entry, and only `~/.forge614/engram`. It never removes `~/.forge614` itself,
`shell/`, or an Atlas directory directly.

Because the present assistant configuration code has add-only plans, this delivery
adds symmetric, guarded removal plans. A removal plan must refuse to alter an entry
that does not exactly match Engram's expected managed form. That protects a person
who has subsequently edited an assistant configuration by hand.

## Release procedure

This repository's official release process is tag-driven, not a local tarball script.
The GitHub release workflow compiles six native binaries, calculates `SHA256SUMS`, and
publishes these release assets:

- `forge614-engram-darwin-arm64`
- `forge614-engram-darwin-x64`
- `forge614-engram-linux-arm64`
- `forge614-engram-linux-x64`
- `forge614-engram-windows-arm64.exe`
- `forge614-engram-windows-x64.exe`
- `SHA256SUMS`
- `install.sh`
- `install.ps1`

For the next stable version, the maintainer updates the package version, completes
the normal tests, merges to `main`, and pushes a version tag such as `v1.1.0`. The
workflow builds and attaches the assets; GitHub marks that stable release as `latest`.
The user installation command therefore always resolves the newest stable release:

```sh
curl -fsSL https://github.com/jotredev/forge614-engram/releases/latest/download/install.sh | bash
```

On Windows:

```powershell
irm https://github.com/jotredev/forge614-engram/releases/latest/download/install.ps1 | iex
```

This layout migration is a minor release (`1.1.0`), not a patch release, because it
changes the product's official installation and storage locations while providing a
safe compatibility migration.

## Testing and verification

Tests must prove at least the following:

- defaults resolve to the product home on every platform;
- installing normally creates only the Engram product directory and publishes its
  product bin path;
- an existing `shell/` or unrelated Forge614 sibling remains unchanged;
- each supported legacy state migrates the known files without data loss;
- conflict, symlink/reparse-point, ownership, malformed, and partial migration cases
  stop safely without deleting or overwriting data;
- both the legacy executable and the new executable discovery paths behave as designed;
- uninstall removes exact managed assistant integrations and rejects modified or
  ambiguous entries;
- Atlas handoff is required and blocks all deletion when unavailable or unsuccessful;
- the release workflow publishes both bootstrap installers with all six verified
  binaries and `SHA256SUMS`.

Before a stable tag is created, the full Bun test suite, static type check, whitespace
check, installer fixture tests, and release-workflow regression tests must pass.
