# 06. Resolución de Problemas

## Instalación o actualización

Usa una terminal macOS/Linux soportada con Bash, `curl` y una utilidad SHA-256. `forge614-engram update` usa el instalador oficial `latest` y conserva el binario anterior si falla validación o instalación. Reintenta después de recuperar conectividad; no reemplaces `engram.db` manualmente.

Para automatización, usa `forge614-engram update --json`. Su éxito es un único JSON compacto en stdout; no debe contener progreso. Si falla, devuelve código `1` y únicamente `{"code":"UPDATE_FAILED","error":"No se pudo actualizar Forge614 Engram."}` en stderr. Ese mensaje deliberadamente no revela diagnósticos del instalador, URLs, credenciales ni secretos.

## Inicialización

`init` requiere terminal interactiva. Usa `init --json` en automatización. `--postgres-url` solo es válido con `init --json`; fallas de conexión devuelven JSON estructurado sin exponer la URL ni dejar configuración parcial.

## Almacenamiento

No borres ni muevas manualmente `~/.forge614/engram/engram.db`. Engram repara permisos solo dentro de su directorio. Si hay configuración pero falta la base, falla de forma segura en vez de crear un reemplazo silencioso.

## Búsqueda y temas

Por debajo del esquema 11, la búsqueda es coincidencia literal FTS5 (sin cambios). Desde el esquema 11 (memoria inteligente) es híbrida: reparte la consulta entre palabras completas y trigramas, combina por rango recíproco (RRF) y pondera por el multiplicador de refuerzo; un resultado necesita al menos 2 de los términos de la consulta y una consulta sin términos útiles no devuelve nada (consulta el capítulo 5). Proporciona un `projectId` para búsquedas de proyecto o usa `--scope shared`. Actualizar un tema requiere su `--expected-version` actual; consulta antes `get` o `history`.

## PostgreSQL

SQLite/FTS5 permanece local aun después de configurar PostgreSQL. Ejecuta `sync` explícitamente. Antes de `sync --upgrade-format`, actualiza cada equipo participante a una versión compatible.

La URL de PostgreSQL es un secreto. Engram nunca la devuelve en resultados, errores de CLI ni respuestas MCP. Si un error de dominio llegara a contener una URL `postgres://` o `postgresql://`, la reemplaza por `[URL de PostgreSQL oculta]`; no expone usuario, contraseña, host, puerto, base de datos ni parámetros. Los errores inesperados usan un mensaje genérico sin detalles internos.

## Grupos, identidad del proyecto y actualización de la base

Desde 1.6.0. Los comandos `group-*`, `memory-move` y los códigos de esta sección devuelven `{schemaVersion,code,error}` por stderr (consulta [11. Ámbitos y Ecosistemas](11-ambitos-y-ecosistemas.md)).

- `GROUP_NAME_INVALID`: el nombre del grupo debe usar minúsculas, dígitos y guiones simples (`mi-tienda`), de 1 a 64 caracteres.
- `GROUP_EXISTS`: ya existe un grupo con ese nombre; usa `group-list`.
- `GROUP_NOT_FOUND`: el grupo no existe en esta base (también cuando la base aún no conoce grupos). Créalo con `group-create`.
- `GROUP_AMBIGUOUS`: varios grupos tienen ese nombre; usa el `id` que muestra `group-list`.
- `GROUP_REQUIRED`: el ámbito `ecosystem` necesita un grupo: indica `--group` o usa un proyecto que pertenezca a uno (`group-bind`).
- `GROUP_INTENT_REQUIRED`: guardar en `ecosystem` con MCP exige un `groupIntent` verdadero.
- `TOPIC_CONFLICT`: `memory-move` no sobrescribe; el grupo ya tiene un recuerdo con ese tema. Archívalo o cambia el tema.
- `PROJECT_FILE_INVALID`: el `.forge614/project.json` no es válido (JSON corrupto, esquema o campos desconocidos, enlace simbólico, demasiado grande). Engram no lo modifica: corrígelo o bórralo para que se regenere.
- `PROJECT_FILE_CONFLICT`: `project-bind` intentó vincular una carpeta cuyo archivo declara otro proyecto; usa esa identidad o borra el archivo.
- `MIGRATION_VERIFY_FAILED`: la verificación de la migración falló y se revirtió todo. La base no cambió y el respaldo `.bak` junto a `engram.db` se conserva; no lo borres y reporta el caso.
- `SYNC_ECOSYSTEM_UNSUPPORTED`: `sync` se detiene mientras existan recuerdos de grupo: las memorias `ecosystem` no se replican todavía (llegará en 1.7.0, «formato 4»). Los datos locales y remotos no se tocan.
- `DATABASE_VERSION` ("Base incompatible: no se puede abrir con esta versión") al abrir con Engram 1.5.x una base actualizada por 1.6.0: actualiza Engram. La base no se modifica; el respaldo previo `.bak` sigue siendo legible por 1.5.x. Un proceso 1.5.x ya iniciado (por ejemplo un servidor MCP) debe reiniciarse tras actualizar.

## Memoria inteligente

Desde 1.7.0. En la CLI estos códigos devuelven `{schemaVersion,code,error}` por stderr.

- `SECRET_REJECTED`: el título, el contenido, el tema o la versión corta parecen contener un secreto (el mensaje dice de qué tipo, nunca el valor). Quita el valor y guarda solo dónde vive, por ejemplo `password: <redacted>` o el nombre de la variable de entorno. Aplica en cualquier nivel de la base.
- `INTELLIGENCE_REQUIRED`: se enviaron `short`, `supersedes` o `affects` y la base aún no tiene la memoria inteligente. Actívala con `forge614-engram intelligence-enable` (respalda antes de migrar) o guarda sin esos campos.
- `SUPERSEDES_NOT_FOUND`: `supersedes` apunta a un recuerdo que no existe, está archivado o es de otro ámbito o proyecto. Busca el id correcto con `memory_search`.
- `AMBIGUOUS_SESSION`: con el esquema 11 ya no lo provocan sesiones abiertas obsoletas (las marcadas como interrumpidas o inactivas por más de 6 horas se ignoran); si aun así aparece, hay dos sesiones de la misma carpeta genuinamente activas: indica `sessionId`.

## Integraciones de IA

Engram no detecta ni configura clientes de IA. Si un cliente MCP no está disponible, usa la ruta pública de setup de Forge614 Engines/Shell; no busques una TUI o comando de asistentes en Engram.

## Desinstalación

Usa la frase exacta de confirmación indicada por help. Si existe Atlas, Engram requiere la confirmación combinada y elimina solo `~/.forge614/engram/` y `~/.forge614/atlas/`.
