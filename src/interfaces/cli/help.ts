export const HELP = `Forge614 Engram — una base, recuerdos por proyecto y compartidos

Uso: forge614-engram <comando> [opciones]

setup           Asistente interactivo; confirma antes de guardar. Cancelar no aplica cambios.
tui             Asistentes: flechas, Espacio, vista previa y confirmación explícita.
init            Inicializa una sola configuración y base local, sin borrar datos.
sync [--upgrade-format]
                Sincroniza todo; --upgrade-format promueve al formato local habilitado (hasta 3).
sync-watch      Reintenta mientras esté abierto [--interval <1..3600 segundos>, defecto 30].
integration-enable  Habilita explícitamente MCP y asociaciones locales (esquema 5).
sessions-enable Habilita explícitamente sesiones (esquema 6).
reinforcement-enable
                Habilita explícitamente repeticiones y orden reforzado (esquema 7).
mcp             Inicia el servidor MCP local por stdio; no migra la base.
assistant-list  Detecta asistentes y muestra configuración/cobertura sin escribir archivos.
memory-hook     --client <claude-code|codex|cursor|opencode|gemini-cli>
project-create  --name <nombre>
project-list    Lista todos los proyectos de la base.
project-rename  --project-id <UUID> --name <nombre>
project-bind    --directory <carpeta> --project-id <UUID>

Recuerdos: --project-id <UUID> (scope project por defecto) O --scope shared.
save     --title <título> --content <texto> [--type fact|decision|procedure|warning|preference]
         [--topic <tema>] [--expected-version <versión>] [--request-key <clave>]
         [--pinned true|false] [--session-id <id>] [--session-project-id <UUID>]
         type=fact por defecto; un save shared con sesión requiere --session-project-id.
get      --id <recuerdo> [--version <n>]
history  --id <recuerdo>
archive  --id <recuerdo>
restore  --id <recuerdo>

search   --query <texto> [--limit <1..100>] [--preview]
         --project-id <UUID> [--scope all|project|shared]
         O --scope shared (sin proyecto)
         limit=10; con proyecto, scope=all: proyecto + shared.

Sesiones (requieren antes sessions-enable; la habilitación y promoción nunca son automáticas):
session-start --directory <carpeta> --session-id <id>
session-end --project-id <UUID> --session-id <id>
session-summary --project-id <UUID> --session-id <id> --summary-json <json>
                --request-key <clave> [--expected-version <n>]
timeline --project-id <UUID> --session-id <id> --id <recuerdo> --version <n>
         [--before <0..20>] [--after <0..20>] (ambos por defecto 5)
context [--project-id <UUID> | --scope shared] [--compact] [--max-bytes <1024..65536>]
        compact=false y max-bytes=16384 por defecto.

help      Muestra esta ayuda sin crear archivos.
--version Muestra la versión instalada.

Una configuración: ~/.forge614/.env. Una base SQLite: ~/.forge614/engram.db.
No hay conexiones, carpetas .env ni bases diferentes por proyecto.
--db, --project y --id-project no se admiten. El identificador se llama projectId.
project-create inicializa el espacio si aún no existe configuración.
Para guardar shared sin crear un proyecto, ejecuta init primero.
No se migran ni borran bases o configuraciones antiguas automáticamente.
SQLite y FTS5 siempre son locales. PostgreSQL es una réplica opcional configurada en setup.
sync incluye todos los proyectos, shared e historial. Conflictos no se sobrescriben.
Antes de sync --upgrade-format, actualiza todos los equipos: todos deben entender el formato seleccionado; el refuerzo requiere formato 3.
sync-watch debe permanecer abierto para reintentar; no se instala un servicio permanente.
setup ofrece el refuerzo explícitamente; registrar repeticiones mejora el orden, no verifica la verdad.
La habilitación local no promueve la réplica: ejecuta sync --upgrade-format por separado.
Las consultas son literales; todas las palabras deben coincidir.
En búsqueda all, un tema activo del proyecto sustituye al mismo tema shared.
El recuerdo compartido se conserva y se puede consultar con --scope shared.
Actualizar un tema requiere --expected-version. Archivar conserva el historial.
setup y tui muestran texto y requieren terminal; cancelar devuelve código 130.
Los comandos de datos devuelven JSON; errores a stderr y código de salida 1, sin conexiones privadas.
MCP expone memory_save a asistentes; el modelo puede omitir guardados. No captura transcripciones.
La resolución de directorios de proyecto requiere Git disponible, incluso para carpetas sin Git.
`;
