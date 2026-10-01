#!/usr/bin/env bash
# Verificación de publicación de Engram: corre los casos del procedimiento manual de 1.5.1 más el de 1.8.4
# contra el binario ya compilado, SIEMPRE con un FORGE614_HOME y un HOME temporales propios, para que nunca
# toque la base real de quien la ejecuta (así quedó el proyecto «Release probe» en la base de un equipo).
#
# Uso: scripts/release-smoke.sh <ruta-del-binario-compilado>
# Código de salida: 0 si todos los casos pasan; distinto de 0 si algo falla o si el entorno no es seguro.
set -euo pipefail

# Primera acción: guarda lo que traía el entorno (solo expansión de variables, no escribe nada) y crea los
# temporales propios, exportándolos antes de cualquier otro comando.
incoming_defined="${FORGE614_HOME+definida}"
incoming_home="${FORGE614_HOME-}"
smoke_forge614_home=""
smoke_home=""
smoke_forge614_home="$(mktemp -d)"
smoke_home="$(mktemp -d)"
export FORGE614_HOME="$smoke_forge614_home"
export HOME="$smoke_home"

# Borra solo los temporales creados arriba, pase lo que pase (éxito, fallo o interrupción).
limpiar() {
  [ -n "$smoke_forge614_home" ] && rm -rf "$smoke_forge614_home"
  [ -n "$smoke_home" ] && rm -rf "$smoke_home"
  return 0
}
trap limpiar EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

fallar() {
  echo "release-smoke: FALLO: $1" >&2
  exit 1
}

# Resuelve una carpeta existente a su ruta física (sin enlaces simbólicos ni «..»); vacío si no existe.
ruta_fisica() {
  (cd -P "$1" 2>/dev/null && pwd -P) || true
}

# Guardián: un FORGE614_HOME que ya venía definido y no está dentro de la carpeta temporal del sistema
# podría ser la base real de alguien; el script se detiene sin escribir nada en él.
if [ -n "$incoming_defined" ]; then
  carpeta_temporal="$(ruta_fisica "${TMPDIR:-/tmp}")"
  entrante=""
  case "$incoming_home" in /*) entrante="$(ruta_fisica "$incoming_home")" ;; esac
  if [ -z "$carpeta_temporal" ] || [ -z "$entrante" ]; then
    echo "release-smoke: FORGE614_HOME ya está definido ('$incoming_home') y no es una carpeta temporal existente; no se escribe nada." >&2
    exit 2
  fi
  case "$entrante/" in
    "$carpeta_temporal"/?*) ;; # dentro de la carpeta temporal: se ignora y se usa el propio
    *)
      echo "release-smoke: FORGE614_HOME ya está definido ('$incoming_home') fuera de la carpeta temporal del sistema; no se escribe nada." >&2
      exit 2
      ;;
  esac
fi

[ "$#" -eq 1 ] || { echo "Uso: $0 <ruta-del-binario-compilado>" >&2; exit 2; }
binario="$1"
[ -f "$binario" ] && [ -x "$binario" ] || { echo "release-smoke: el binario '$binario' no existe o no es ejecutable." >&2; exit 2; }
binario="$(cd "$(dirname "$binario")" && pwd -P)/$(basename "$binario")"

salida=""
codigo=0
# Corre el binario y guarda su salida (stdout y stderr juntas) y su código sin cortar el script.
correr() {
  set +e
  salida="$("$binario" "$@" 2>&1)"
  codigo=$?
  set -e
}
# Exige que el último comando saliera con el código dado y que su salida contenga el texto (si se da uno).
verificar() {
  local nombre="$1" esperado="$2" texto="${3-}"
  [ "$codigo" -eq "$esperado" ] || fallar "$nombre: salió con código $codigo (se esperaba $esperado). Salida: $salida"
  if [ -n "$texto" ]; then
    case "$salida" in *"$texto"*) ;; *) fallar "$nombre: la salida no contiene «$texto». Salida: $salida" ;; esac
  fi
  echo "ok  $nombre"
}
# Extrae el valor de un campo de texto de un JSON impreso con sangría (sin depender de jq).
campo() {
  printf '%s\n' "$salida" | sed -n "s/^ *\"$1\": \"\\([^\"]*\\)\".*/\\1/p" | head -n 1
}
nueva_carpeta_git() {
  mkdir -p "$1"
  git init --quiet "$1"
}

trabajo="$smoke_home/trabajo"
mkdir -p "$trabajo/sin-git"

# 1. init: crea el espacio dentro del FORGE614_HOME temporal.
correr init --json
verificar "init" 0
[ -f "$FORGE614_HOME/engram/engram.db" ] || fallar "init: la base no quedó en el FORGE614_HOME temporal"

# 2. startup-context solo lee: una carpeta sin Git, el HOME y una carpeta Git sin vínculo quedan «unbound» y no crean nada.
correr startup-context --directory "$trabajo/sin-git" --json
verificar "startup-context carpeta sin Git" 0 '"status": "unbound"'
correr startup-context --directory "$HOME" --json
verificar "startup-context HOME" 0 '"status": "unbound"'
nueva_carpeta_git "$trabajo/git-sin-vinculo"
correr startup-context --directory "$trabajo/git-sin-vinculo" --json
verificar "startup-context carpeta Git sin vínculo" 0 '"status": "unbound"'
correr project-list
verificar "ningún proyecto creado por lecturas" 0 '[]'

# 3. Carpeta Git vinculada: session-start la registra y save guarda en ella.
correr sessions-enable
verificar "sessions-enable" 0
nueva_carpeta_git "$trabajo/git-vinculada"
correr session-start --directory "$trabajo/git-vinculada" --session-id smoke-bound
verificar "session-start carpeta Git" 0 '"projectId"'
proyecto="$(campo projectId)"
[ -n "$proyecto" ] || fallar "session-start: no devolvió projectId"
correr startup-context --directory "$trabajo/git-vinculada" --json
verificar "startup-context carpeta Git vinculada" 0 '"status": "bound"'
correr save --project-id "$proyecto" --title "Smoke" --content "Release smoke check" --session-id smoke-bound
verificar "save en la carpeta vinculada" 0 '"title": "Smoke"'

# 4. Carpeta inexistente: error claro y sin crear nada.
correr startup-context --directory "$trabajo/no-existe" --json
verificar "carpeta inexistente" 1 'INVALID_DIRECTORY'

# 5. Caso de 1.8.4: una carpeta vinculada que se borra no bloquea otra carpeta nueva con otro nombre.
nueva_carpeta_git "$trabajo/carpeta-borrada"
correr session-start --directory "$trabajo/carpeta-borrada" --session-id smoke-lost
verificar "session-start de la carpeta que se borrará" 0 '"projectId"'
perdido="$(campo projectId)"
rm -rf "$trabajo/carpeta-borrada"
nueva_carpeta_git "$trabajo/carpeta-nueva"
correr session-start --directory "$trabajo/carpeta-nueva" --session-id smoke-new
verificar "carpeta nueva con otra carpeta perdida" 0 '"projectId"'
nuevo="$(campo projectId)"
[ -n "$nuevo" ] && [ "$nuevo" != "$perdido" ] || fallar "la carpeta nueva no creó su propio proyecto"
correr startup-context --directory "$trabajo/carpeta-nueva" --json
verificar "startup-context de la carpeta nueva" 0 '"status": "bound"'

# Nada de lo anterior debe haber salido del HOME y el FORGE614_HOME temporales.
[ ! -e "$HOME/.forge614" ] || fallar "se creó $HOME/.forge614 dentro del HOME temporal"
echo "release-smoke: todos los casos pasaron con FORGE614_HOME temporal"
