#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' \
    'Instala forge614-engram desde este repositorio, sin npm.' \
    'Uso: bash scripts/install.sh [--bin-dir RUTA] [--force]' \
    'Requiere Bun >=1.3.8 para compilar; el ejecutable instalado no requiere Bun.' \
    'Destino predeterminado: $HOME/.local/bin/forge614-engram' \
    '--force reemplaza una instalación existente. No cambia las bases de recuerdos.' \
    'No modifica tu configuración de terminal ni descarga dependencias.'
}

fail() { printf '%s\n' "$1" >&2; exit 1; }
bin_dir="${HOME:?HOME no está definido}/.local/bin"
force=0
seen_dir=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --bin-dir)
      [ "$#" -ge 2 ] && [ -n "$2" ] && [ "$seen_dir" -eq 0 ] || fail 'Especifica una sola ruta para --bin-dir.'
      case "$2" in --*) fail 'Falta una ruta válida para --bin-dir.' ;; esac
      bin_dir="$2"
      seen_dir=1
      shift 2 ;;
    --force) force=1; shift ;;
    *) fail 'Opción desconocida. Consulta: bash scripts/install.sh --help' ;;
  esac
done

case "$(uname -s)" in Darwin|Linux) ;; *) fail 'Este instalador requiere macOS o Linux con Bash.' ;; esac
command -v bun >/dev/null 2>&1 || fail 'Se necesita Bun >=1.3.8 para compilar. Instálalo desde https://bun.sh y repite.'
bun_version="$(bun --version)"
IFS=. read -r bun_major bun_minor bun_patch <<< "$bun_version"
[[ "$bun_major" =~ ^[0-9]+$ && "$bun_minor" =~ ^[0-9]+$ && "$bun_patch" =~ ^[0-9]+$ ]] || fail 'Se requiere una versión estable de Bun >=1.3.8.'
if (( bun_major < 1 || (bun_major == 1 && bun_minor < 3) || (bun_major == 1 && bun_minor == 3 && bun_patch < 8) )); then
  fail 'Actualiza Bun: se requiere >=1.3.8.'
fi

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
case "$bin_dir" in /*) ;; *) bin_dir="$PWD/$bin_dir" ;; esac
destination="$bin_dir/forge614-engram"
[ ! -d "$destination" ] || fail 'El destino es una carpeta; elige otra ruta.'
if { [ -e "$destination" ] || [ -L "$destination" ]; } && [ "$force" -ne 1 ]; then
  fail 'El comando ya existe. Usa --force para reemplazarlo explícitamente.'
fi

build_dir="$(mktemp -d "${TMPDIR:-/tmp}/forge614-build.XXXXXX")"
staging=""
cleanup() {
  if [ -n "$staging" ]; then rm -f -- "$staging"; fi
  rm -f -- "$build_dir/forge614-engram"
  rmdir -- "$build_dir" 2>/dev/null || true
}
trap cleanup EXIT

# Compile the checkout the user selected; no network install and no global config changes.
(cd -- "$repo_dir" && bun build ./src/cli.ts --compile --outfile "$build_dir/forge614-engram")
"$build_dir/forge614-engram" --version
mkdir -p -- "$bin_dir"
staging="$(mktemp "$bin_dir/.forge614-engram.XXXXXX")"
cp -- "$build_dir/forge614-engram" "$staging"
chmod 755 "$staging"
if [ "$force" -eq 1 ]; then
  mv -f -- "$staging" "$destination"
else
  # Hard-link publication is atomic and refuses a concurrently created destination.
  ln -- "$staging" "$destination"
  rm -f -- "$staging"
fi
staging=""
printf 'Instalado: %s\n' "$destination"
case ":${PATH:-}:" in
  *":$bin_dir:"*) printf '%s\n' 'Listo: forge614-engram help' ;;
  *)
    printf '%s\n' 'Añade esta carpeta al PATH de tu terminal para usar el comando por nombre:'
    printf 'export PATH=%q:"$PATH"\n' "$bin_dir"
    printf '%s\n' 'La línea anterior sirve en Bash/Zsh; guárdala en la configuración de tu terminal si quieres conservarla.' ;;
esac
