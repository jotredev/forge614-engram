#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' \
    'Install Forge614 Engram by compiling this prepared repository checkout.' \
    'For repository developers only; this is not the end-user installation route.' \
    'Usage: bash scripts/install-from-source.sh [--bin-dir PATH] [--force]' \
    'Requires Bun >=1.3.8, Git, and a prepared Bun checkout.' \
    'Prepare dependencies with: bun install --frozen-lockfile --ignore-scripts' \
    'Default destination: $HOME/.local/bin/forge614-engram' \
    '--force explicitly replaces an existing installation.'
}

fail() { printf '%s\n' "$1" >&2; exit 1; }
bin_dir="${HOME:?HOME must be set}/.local/bin"
force=0
seen_dir=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --bin-dir)
      [ "$#" -ge 2 ] && [ -n "$2" ] && [ "$seen_dir" -eq 0 ] || fail 'Specify one path for --bin-dir.'
      case "$2" in --*) fail 'Specify a valid path for --bin-dir.' ;; esac
      bin_dir="$2"
      seen_dir=1
      shift 2 ;;
    --force) force=1; shift ;;
    *) fail 'Unknown option. See: bash scripts/install-from-source.sh --help' ;;
  esac
done

case "$(uname -s)" in Darwin|Linux) ;; *) fail 'This developer installer requires macOS or Linux with Bash.' ;; esac
command -v bun >/dev/null 2>&1 || fail 'Bun >=1.3.8 is required to compile. Install Bun and try again.'
command -v git >/dev/null 2>&1 || fail 'Git is required to resolve project directories, including non-Git folders. Install Git and try again; this installer does not download Git.'
bun_version="$(bun --version)"
IFS=. read -r bun_major bun_minor bun_patch <<< "$bun_version"
[[ "$bun_major" =~ ^[0-9]+$ && "$bun_minor" =~ ^[0-9]+$ && "$bun_patch" =~ ^[0-9]+$ ]] || fail 'A stable Bun version >=1.3.8 is required.'
if (( bun_major < 1 || (bun_major == 1 && bun_minor < 3) || (bun_major == 1 && bun_minor == 3 && bun_patch < 8) )); then
  fail 'Update Bun: version >=1.3.8 is required.'
fi

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if ! (cd -- "$repo_dir" && bun -e '
  const fs = require("node:fs");
  const expected = JSON.parse(fs.readFileSync("package.json", "utf8")).dependencies;
  try {
    for (const [name, version] of Object.entries(expected)) {
      if (JSON.parse(fs.readFileSync("node_modules/" + name + "/package.json", "utf8")).version !== version) process.exit(1);
    }
  } catch { process.exit(1); }
'); then
  fail 'Local dependencies are missing or have different versions. In the repository run: bun install --frozen-lockfile --ignore-scripts; then try again.'
fi
case "$bin_dir" in /*) ;; *) bin_dir="$PWD/$bin_dir" ;; esac
destination="$bin_dir/forge614-engram"
[ ! -d "$destination" ] || fail 'The destination is a directory; choose a different path.'
if { [ -e "$destination" ] || [ -L "$destination" ]; } && [ "$force" -ne 1 ]; then
  fail 'The command already exists. Use --force to replace it explicitly.'
fi

build_dir="$(mktemp -d "${TMPDIR:-/tmp}/forge614-build.XXXXXX")"
staging=''
cleanup() {
  if [ -n "$staging" ]; then rm -f -- "$staging"; fi
  rm -f -- "$build_dir/forge614-engram"
  rmdir -- "$build_dir" 2>/dev/null || true
}
trap cleanup EXIT

if ! (cd -- "$repo_dir" && bun build ./src/cli.ts --compile --outfile "$build_dir/forge614-engram"); then
  fail 'Compilation failed. Check the code and prepare dependencies with: bun install --frozen-lockfile --ignore-scripts'
fi
"$build_dir/forge614-engram" --version
mkdir -p -- "$bin_dir"
staging="$(mktemp "$bin_dir/.forge614-engram.XXXXXX")"
cp -- "$build_dir/forge614-engram" "$staging"
chmod 755 "$staging"
if [ "$force" -eq 1 ]; then
  mv -f -- "$staging" "$destination"
else
  ln -- "$staging" "$destination"
  rm -f -- "$staging"
fi
staging=''
printf 'Installed: %s\n' "$destination"
case ":${PATH:-}:" in
  *":$bin_dir:"*) printf '%s\n' 'forge614-engram setup' ;;
  *)
    printf '%s\n' 'Add this directory to your terminal PATH to use the command by name:'
    printf 'export PATH=%q:"$PATH"\n' "$bin_dir"
    printf '%s\n' 'The preceding line works in Bash/Zsh; save it in your shell configuration to keep it.'
    printf '%s\n' 'forge614-engram setup' ;;
esac
