#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' \
    'Install a verified Forge614 Engram release binary.' \
    'Usage: bash scripts/install.sh [--version TAG] [--bin-dir PATH] [--force]' \
    'Default destination: $HOME/.forge614/engram/bin/forge614-engram' \
    '--force explicitly replaces an existing installation.'
}

fail() { printf '%s\n' "$1" >&2; exit 1; }

path_marker_start='# >>> forge614-engram PATH >>>'
path_marker_end='# <<< forge614-engram PATH <<<'

manual_path_guidance() {
  local bin_dir="$1"
  printf '%s\n' 'Add this directory to your terminal PATH manually:'
  printf 'export PATH=%q:"$PATH"\n' "$bin_dir"
}

prepare_bin_directory() {
  local forge_home product_home
  if [ "$bin_dir" != "$HOME/.forge614/engram/bin" ]; then
    mkdir -p -- "$bin_dir"
    [ -d "$bin_dir" ] && [ ! -L "$bin_dir" ] || return 1
    return 0
  fi
  forge_home="$HOME/.forge614"
  product_home="$forge_home/engram"
  [ ! -L "$forge_home" ] && { [ ! -e "$forge_home" ] || [ -d "$forge_home" ]; } || return 1
  if [ ! -e "$forge_home" ]; then mkdir -- "$forge_home" || return 1; chmod 700 "$forge_home" || return 1; fi
  [ ! -L "$product_home" ] && { [ ! -e "$product_home" ] || [ -d "$product_home" ]; } || return 1
  mkdir -p -- "$bin_dir" || return 1
  [ ! -L "$product_home" ] && [ ! -L "$bin_dir" ] || return 1
  chmod 700 "$product_home" "$bin_dir" || return 1
}

replace_path_marker_block() {
  local configuration_file="$1"
  local path_command="$2"
  local configuration_dir temporary_file
  # Dotfile managers own symlinks; replacing one would detach its target.
  [ ! -L "$configuration_file" ] || return 1
  [ ! -e "$configuration_file" ] || [ -f "$configuration_file" ] || return 1
  configuration_dir="$(dirname -- "$configuration_file")"
  mkdir -p -- "$configuration_dir" || return 1
  temporary_file="$(mktemp "${configuration_file}.XXXXXX")" || return 1

  if [ -f "$configuration_file" ]; then
    awk -v start="$path_marker_start" -v end="$path_marker_end" '
      $0 == start {
        if (inside_block) { invalid = 1; exit 1 }
        inside_block = 1
        next
      }
      $0 == end {
        if (!inside_block) { invalid = 1; exit 1 }
        inside_block = 0
        next
      }
      !inside_block { print }
      END {
        if (invalid || inside_block) exit 1
      }
    ' "$configuration_file" > "$temporary_file" || {
      rm -f -- "$temporary_file"
      return 1
    }
  else
    : > "$temporary_file" || return 1
  fi

  printf '%s\n%s\n%s\n' "$path_marker_start" "$path_command" "$path_marker_end" >> "$temporary_file" || {
    rm -f -- "$temporary_file"
    return 1
  }
  mv -f -- "$temporary_file" "$configuration_file"
}

publish_path_for_future_shell() {
  local bin_dir="$1"
  local configuration_file path_command
  case "${SHELL:-}" in
    */zsh|zsh)
      configuration_file="$HOME/.zshrc"
      path_command="$(printf 'case ":$PATH:" in\n  *:%q:*) ;;\n  *) export PATH=%q:"$PATH" ;;\nesac' "$bin_dir" "$bin_dir")"
      ;;
    */bash|bash)
      case "$(uname -s)" in
        Darwin)
          configuration_file="$HOME/.bash_profile"
          # Creating a higher-precedence file would suppress the active login profile.
          if [ ! -e "$configuration_file" ] && [ ! -L "$configuration_file" ]; then
            if [ -e "$HOME/.bash_login" ] || [ -L "$HOME/.bash_login" ] || [ -e "$HOME/.profile" ] || [ -L "$HOME/.profile" ]; then
              return 1
            fi
          fi
          ;;
        Linux) configuration_file="$HOME/.bashrc" ;;
        *) return 2 ;;
      esac
      path_command="$(printf 'case ":$PATH:" in\n  *:%q:*) ;;\n  *) export PATH=%q:"$PATH" ;;\nesac' "$bin_dir" "$bin_dir")"
      ;;
    */fish|fish)
      configuration_file="$HOME/.config/fish/conf.d/forge614-engram.fish"
      path_command="$(printf 'if not contains -- %q $PATH\n  set -gx PATH %q $PATH\nend' "$bin_dir" "$bin_dir")"
      ;;
    *) return 2 ;;
  esac

  replace_path_marker_block "$configuration_file" "$path_command" || return 1
  printf 'Added %s to PATH in %s. Open a new terminal to use forge614-engram.\n' "$bin_dir" "$configuration_file"
}

is_loopback_test_url() {
  local url="$1"
  local port
  [[ "$url" =~ ^http://(127\.0\.0\.1|localhost):([0-9]+)(/[^\?#]*)?$ ]] || return 1
  port="${BASH_REMATCH[2]}"
  (( 10#$port >= 1 && 10#$port <= 65535 ))
}

install_engines_dependency() {
  local engines_command engines_installer installer_url
  engines_command="$HOME/.forge614/engines/bin/forge614-engines"
  if [ -x "$engines_command" ]; then
    printf '%s\n' "Forge614 Engines is already available: $engines_command"
    return 0
  fi

  installer_url='https://github.com/jotredev/forge614-engines/releases/latest/download/install.sh'
  if [ -n "${FORGE614_ENGINES_INSTALLER_TEST_URL:-}" ]; then
    [ "${FORGE614_ENGRAM_INSTALLER_TEST:-}" = '1' ] || fail 'The Engines installer override is reserved for test fixtures.'
    installer_url="$FORGE614_ENGINES_INSTALLER_TEST_URL"
    case "$installer_url" in file:///*) ;; *) fail 'The Engines test installer must be a local file URL.' ;; esac
  fi

  engines_installer="$download_dir/forge614-engines-install.sh"
  curl --fail --location --proto '=https,file' --tlsv1.2 --silent --show-error "$installer_url" --output "$engines_installer" \
    || fail 'Could not download the Forge614 Engines installer.'
  bash "$engines_installer" --latest || fail 'Forge614 Engines could not be installed; Engram was not changed.'
  [ -x "$engines_command" ] || fail 'Forge614 Engines installation did not provide its required command.'
}

repo='jotredev/forge614-engram'
bin_dir="${HOME:?HOME must be set}/.forge614/engram/bin"
version=''
force=0
seen_bin_dir=0
seen_version=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --version)
      [ "$#" -ge 2 ] && [ -n "$2" ] && [ "$seen_version" -eq 0 ] || fail 'Specify one tag for --version.'
      case "$2" in --*) fail 'Specify a valid tag for --version.' ;; esac
      version="$2"
      seen_version=1
      shift 2 ;;
    --bin-dir)
      [ "$#" -ge 2 ] && [ -n "$2" ] && [ "$seen_bin_dir" -eq 0 ] || fail 'Specify one path for --bin-dir.'
      case "$2" in --*) fail 'Specify a valid path for --bin-dir.' ;; esac
      bin_dir="$2"
      seen_bin_dir=1
      shift 2 ;;
    --force) force=1; shift ;;
    *) fail 'Unknown option. See: bash scripts/install.sh --help' ;;
  esac
done

if [ -n "$version" ] && ! [[ "$version" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z][0-9A-Za-z.-]*)?$ ]]; then
  fail 'Invalid release tag. Use a semantic version tag such as v1.2.3.'
fi

case "$bin_dir" in /*) ;; *) bin_dir="$PWD/$bin_dir" ;; esac
destination="$bin_dir/forge614-engram"
[ ! -d "$destination" ] || fail 'The destination is a directory; choose a different --bin-dir.'
if { [ -e "$destination" ] || [ -L "$destination" ]; } && [ "$force" -ne 1 ]; then
  fail 'The command already exists. Use --force to replace it explicitly.'
fi

case "$(uname -s)/$(uname -m)" in
  Darwin/x86_64) artifact='forge614-engram-darwin-x64' ;;
  Darwin/arm64) artifact='forge614-engram-darwin-arm64' ;;
  Linux/x86_64) artifact='forge614-engram-linux-x64' ;;
  Linux/aarch64) artifact='forge614-engram-linux-arm64' ;;
  *) fail 'Unsupported operating system or architecture. Supported: macOS x64/arm64 and Linux x64/arm64.' ;;
esac

command -v curl >/dev/null 2>&1 || fail 'curl is required to download a release.'
if command -v shasum >/dev/null 2>&1; then
  checksum_tool='shasum'
elif command -v sha256sum >/dev/null 2>&1; then
  checksum_tool='sha256sum'
else
  fail 'A SHA-256 command is required: shasum or sha256sum.'
fi

selector='latest'
if [ -n "$version" ]; then selector="tags/$version"; fi
release_json_url="https://api.github.com/repos/${repo}/releases/${selector}"
curl_protocol='=https'
test_endpoint=0

# This endpoint is intentionally available only to the disposable installer tests.
# It is neither a supported installation option nor part of the user help.
if [ -n "${FORGE614_ENGRAM_TEST_RELEASE_BASE_URL:-}" ]; then
  [ "${FORGE614_ENGRAM_INSTALLER_TEST:-}" = '1' ] || fail 'The release endpoint override is reserved for test fixtures.'
  test_base_url="${FORGE614_ENGRAM_TEST_RELEASE_BASE_URL%/}"
  is_loopback_test_url "$test_base_url" || fail 'The test release endpoint must be a loopback HTTP URL with an explicit numeric port.'
  release_json_url="${test_base_url}/repos/${repo}/releases/${selector}"
  curl_protocol='=http,https'
  test_endpoint=1
fi

download_dir="$(mktemp -d "${TMPDIR:-/tmp}/forge614-engram-release.XXXXXX")"
staging=''
cleanup() {
  [ -z "$staging" ] || rm -f -- "$staging"
  rm -rf -- "$download_dir"
}
trap cleanup EXIT

download() {
  curl --fail --location --proto "$curl_protocol" --tlsv1.2 --silent --show-error "$1" --output "$2"
}

asset_url() {
  local asset_name="$1"
  tr '{' '\n' < "$download_dir/release.json" \
    | sed -n 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"[:space:]]*\)".*/\1/p' \
    | awk -v asset_name="$asset_name" '
        substr($0, length($0) - length(asset_name) + 1) == asset_name {
          count += 1
          url = $0
        }
        END {
          if (count != 1) exit 1
          print url
        }
      '
}

download "$release_json_url" "$download_dir/release.json" || fail 'Could not download release metadata.'
manifest_url="$(asset_url SHA256SUMS)" || fail 'The release is missing SHA256SUMS.'
binary_url="$(asset_url "$artifact")" || fail "The release is missing the ${artifact} binary."
if [ "$test_endpoint" -eq 1 ]; then
  is_loopback_test_url "$manifest_url" || fail 'Release metadata contains an unsafe test fixture URL.'
  is_loopback_test_url "$binary_url" || fail 'Release metadata contains an unsafe test fixture URL.'
else
  case "$manifest_url/$binary_url" in https://*/*) ;; *) fail 'Release assets must use HTTPS URLs.' ;; esac
fi

download "$manifest_url" "$download_dir/SHA256SUMS" || fail 'Could not download SHA256SUMS.'
download "$binary_url" "$download_dir/$artifact" || fail "Could not download ${artifact}."
expected_digest="$(awk -v artifact="$artifact" '
  $2 == artifact && length($1) == 64 && $1 ~ /^[0-9a-f]+$/ { count += 1; digest = $1 }
  END { if (count != 1) exit 1; print digest }
' "$download_dir/SHA256SUMS")" || fail "SHA256SUMS does not contain one valid digest for ${artifact}."
if [ "$checksum_tool" = 'shasum' ]; then
  actual_digest="$(shasum -a 256 -- "$download_dir/$artifact" | awk '{print $1}')"
else
  actual_digest="$(sha256sum -- "$download_dir/$artifact" | awk '{print $1}')"
fi
[ "$expected_digest" = "$actual_digest" ] || fail "Checksum verification failed for ${artifact}."

install_engines_dependency
prepare_bin_directory || fail 'Could not safely create the selected Engram installation directory.'
[ ! -d "$destination" ] || fail 'The destination is a directory; choose a different --bin-dir.'
if { [ -e "$destination" ] || [ -L "$destination" ]; } && [ "$force" -ne 1 ]; then
  fail 'The command already exists. Use --force to replace it explicitly.'
fi
staging="$(mktemp "$bin_dir/.forge614-engram.XXXXXX")"
cp -- "$download_dir/$artifact" "$staging"
chmod 755 "$staging"
if [ "$force" -eq 1 ]; then
  mv -f -- "$staging" "$destination"
else
  ln -- "$staging" "$destination" || fail 'The command was created concurrently; rerun with --force only if replacement is intended.'
  rm -f -- "$staging"
fi
staging=''
printf 'Installed: %s\n' "$destination"
if ! publish_path_for_future_shell "$bin_dir"; then
  printf '%s\n' 'Could not update PATH configuration automatically.'
  manual_path_guidance "$bin_dir"
fi
printf '%s\n' 'forge614-engram init'
