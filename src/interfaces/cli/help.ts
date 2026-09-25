export const HELP = `Forge614 Engram — una base, recuerdos por proyecto y compartidos

Uso: forge614-engram <comando> [opciones]

init [--json] [--postgres-url <URL>]
                Inicializa Engram; --json no pregunta. --postgres-url solo se acepta con --json.
                Con --json también acepta --directory <carpeta>: vincula esa carpeta como proyecto y escribe
                .forge614/project.json en silencio (identidad portátil; repetirlo no cambia nada).
update [--json] Descarga, verifica y activa la última versión estable de Engram; --json devuelve el resultado estructurado.
memory-protocol --json [--protocol-version 1|2|3|4]
                Publica las reglas versionadas que Engines instala en asistentes compatibles. Defecto 1.
                La versión 3 anuncia el ámbito ecosystem y exige groupIntent al guardar en él.
                La versión 4 es el manual de la memoria inteligente (completo y para MCP) y anuncia startup-context --format 2.
startup-context --directory <carpeta> --json [--format 1|2]
                Interfaz pública, no interactiva y de solo lectura para precargar contexto al iniciar
                una sesión de agente: shared y, si <carpeta> ya está vinculada, el proyecto correspondiente.
                Acepta cualquier carpeta existente y legible; sin vínculo devuelve unbound, no es un error
                y nunca crea proyectos, vínculos, recuerdos ni bases.
                Devuelve además el bloque ecosystem (si el proyecto pertenece a un grupo) y project.source
                (file, path o unbound). Mantiene al día la identidad del repositorio: registra por id un clon
                que trae su .forge614/project.json y escribe ese archivo a un proyecto vinculado solo por ruta.
                --format 2 devuelve un solo bloque de texto listo para inyectar (máximo 5000 caracteres):
                esencial fijado, sesión anterior interrumpida e índice de títulos. Defecto 1.
uninstall       --confirm <frase exacta>; elimina solo Engram tras confirmación explícita.
sync [--upgrade-format]
                Sincroniza todo; --upgrade-format promueve al formato local habilitado (hasta 3).
sync-watch      Reintenta mientras esté abierto [--interval <1..3600 segundos>, defecto 30].
sessions-enable Habilita explícitamente sesiones (esquema 6).
reinforcement-enable
                Habilita explícitamente repeticiones y orden reforzado (esquema 7).
intelligence-enable
                Habilita explícitamente la memoria inteligente (esquema 11); respalda la base antes de migrar.
mcp             Inicia el servidor MCP local por stdio; no migra la base.
project-create  --name <nombre>
project-list    Lista todos los proyectos de la base.
project-rename  --project-id <UUID> --name <nombre>
project-bind    --directory <carpeta> --project-id <UUID>
group-create    --name <nombre>   (minúsculas, dígitos y guiones: mi-tienda)
group-list      Lista los grupos y los proyectos de cada uno.
group-bind      --project-id <UUID> --group <nombre|id>   (un proyecto pertenece como máximo a un grupo)
group-unbind    --project-id <UUID>
group-rename    --group <nombre|id> --name <nombre>
group-source-set --group <nombre|id> --project-id <UUID>
memory-move     --id <recuerdo> --to-scope ecosystem --group <nombre|id> [--project-id <UUID> | --scope shared]
                Mueve un recuerdo a un grupo conservando su historial; queda registrado y nunca copia ni borra en silencio.
memory-demote   --id <recuerdo> --project-id <UUID>
                Baja un recuerdo del tablero al proyecto conservando su historial.

Recuerdos: --project-id <UUID> (scope project por defecto) O --scope shared.
Grupos: --scope ecosystem --group <nombre|id> en save, get, history, archive, restore y context; search acepta también --project-id.
save     --title <título> --content <texto> [--type fact|decision|procedure|warning|preference]
         [--topic <tema>] [--expected-version <versión>] [--request-key <clave>]
         [--pinned true|false] [--session-id <id>] [--session-project-id <UUID>]
         [--affects <proyecto-a,proyecto-b,...>]
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
context --scope ecosystem --group <nombre|id> [--compact] [--max-bytes <1024..65536>]

help      Muestra esta ayuda sin crear archivos.
--version Muestra la versión instalada.

Una configuración: ~/.forge614/engram/.env. Una base SQLite: ~/.forge614/engram/engram.db.
FORGE614_HOME absoluta sustituye ~/.forge614 para toda ruta de Engram; vacía o relativa devuelve INVALID_FORGE614_HOME.
No hay conexiones, carpetas .env ni bases diferentes por proyecto.
--db, --project y --id-project no se admiten. El identificador se llama projectId.
project-create inicializa el espacio si aún no existe configuración.
Para guardar shared sin crear un proyecto, ejecuta init primero.
init puede mover la ubicación antigua de Engram a ~/.forge614/engram cuando es seguro; nunca reemplaza datos en conflicto.
SQLite y FTS5 siempre son locales. PostgreSQL es una réplica opcional configurada con init.
sync incluye todos los proyectos, shared e historial. Conflictos no se sobrescriben.
Antes de sync --upgrade-format, actualiza todos los equipos: todos deben entender el formato seleccionado; el refuerzo requiere formato 3.
sync-watch debe permanecer abierto para reintentar; no se instala un servicio permanente.
init ofrece el refuerzo explícitamente; registrar repeticiones mejora el orden, no verifica la verdad.
La habilitación local no promueve la réplica: ejecuta sync --upgrade-format por separado.
Las consultas son literales; todas las palabras deben coincidir.
En búsqueda all, un tema activo del proyecto sustituye al mismo tema shared.
Si el proyecto pertenece a un grupo, all incluye su ecosystem y la precedencia es proyecto, grupo, shared.
El recuerdo compartido se conserva y se puede consultar con --scope shared.
Actualizar un tema requiere --expected-version. Archivar conserva el historial.
init sin --json muestra texto y requiere terminal; cancelar devuelve código 130.
Los comandos de datos devuelven JSON; errores a stderr y código de salida 1, sin conexiones privadas.
Los comandos group-* y memory-move llevan schemaVersion en su salida y en sus errores ({schemaVersion, code, error}).
Crear el primer grupo actualiza la base con un respaldo automático previo; Engram 1.5.3 no abre una base ya actualizada.
MCP expone memory_save a asistentes; el modelo puede omitir guardados. No captura transcripciones.
uninstall requiere REMOVE FORGE614-ENGRAM; si Atlas existe requiere REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS.
La vinculación de directorios de proyecto requiere una identidad de proyecto apta para vínculo; startup-context no.
`;
