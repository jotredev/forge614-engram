# 06. Resolución de Problemas

## Instalación o actualización

Usa una terminal macOS/Linux soportada con Bash, `curl` y una utilidad SHA-256. `forge614-engram update` usa el instalador oficial `latest` y conserva el binario anterior si falla validación o instalación. Reintenta después de recuperar conectividad; no reemplaces `engram.db` manualmente.

## Inicialización

`init` requiere terminal interactiva. Usa `init --json` en automatización. `--postgres-url` solo es válido con `init --json`; fallas de conexión devuelven JSON estructurado sin exponer la URL ni dejar configuración parcial.

## Almacenamiento

No borres ni muevas manualmente `~/.forge614/engram/engram.db`. Engram repara permisos solo dentro de su directorio. Si hay configuración pero falta la base, falla de forma segura en vez de crear un reemplazo silencioso.

## Búsqueda y temas

La búsqueda es coincidencia literal FTS5. Proporciona un `projectId` para búsquedas de proyecto o usa `--scope shared`. Actualizar un tema requiere su `--expected-version` actual; consulta antes `get` o `history`.

## PostgreSQL

SQLite/FTS5 permanece local aun después de configurar PostgreSQL. Ejecuta `sync` explícitamente. Antes de `sync --upgrade-format`, actualiza cada equipo participante a una versión compatible.

## Integraciones de IA

Engram no detecta ni configura clientes de IA. Si un cliente MCP no está disponible, usa la ruta pública de setup de Forge614 Engines/Shell; no busques una TUI o comando de asistentes en Engram.

## Desinstalación

Usa la frase exacta de confirmación indicada por help. Si existe Atlas, Engram requiere la confirmación combinada y elimina solo `~/.forge614/engram/` y `~/.forge614/atlas/`.
