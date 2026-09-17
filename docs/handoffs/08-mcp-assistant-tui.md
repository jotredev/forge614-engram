# Entrega 08 — MCP local y menú de asistentes

Versión 0.5.0. TypeScript/Bun; el ejecutable compilado funciona sin Bun ni Node.
La implementación añade MCP por stdio, asociaciones locales de proyectos y
configuración guiada para Claude Code, Codex, Cursor, OpenCode y Gemini CLI.
No hay servidor Cloud propio, captura de transcripciones ni modelo independiente.

## Comandos y recorrido implementados

```sh
bun install --frozen-lockfile --ignore-scripts
bash scripts/install.sh --bin-dir /ruta/a/bin
forge614-engram tui
forge614-engram assistant-list
forge614-engram integration-enable
forge614-engram mcp
forge614-engram project-bind --directory /ruta/al/proyecto --project-id UUID
forge614-engram memory-hook --client codex
```

`tui` abre Asistentes/Salir. Flechas navegan; Espacio selecciona cualquiera de los
cinco clientes; Enter abre vista previa, otro Enter abre confirmación y el Enter
de esa pantalla confirma. Escape vuelve y Ctrl+C cancela/restaura la terminal.
`r` vuelve a detectar; `c` permite introducir ejecutable del cliente y directorio
de configuración personalizados. Ambas entradas están ocultas; no pegar secretos.
En vista previa/resultados las flechas desplazan el texto si la pantalla es pequeña.
PgUp/PgDn desplazan detalles y avisos, incluida la lista de asistentes.
`t` o «Probar servidor propio (opcional)» inicia una autoprueba asíncrona de Engram.
Escape durante la prueba cancela solo la prueba y conserva la selección; Ctrl+C,
EOF o error de entrada cierran el proceso hijo y restauran la terminal.

Seleccionar y previsualizar no escriben. Confirmar valida todos los planes antes
de preparar el espacio global y habilitar esquema 5 con el servicio existente;
luego aplica los clientes seleccionados. La aplicación vuelve a comprobar los
archivos. Puede haber fallos parciales: se muestran archivos aplicados, copias
retenidas y errores. No se deshacen cambios de otro cliente ni de otros procesos.
Cancelar antes de confirmar deja ausente una carpeta `~/.forge614` nueva.
Los recuerdos y la configuración del espacio existente se conservan.

La lista distingue ejecutable detectado de evidencia de configuración obsoleta,
estado de configuración de sesión probada, cobertura de hooks y restricciones.
No muestra contenido de archivos ni credenciales. Ningún cliente se inicia durante
detección. Configurado no significa conectado. La autoprueba usa el SDK oficial
por stdio para inicializar el ejecutable propio instalado y listar las cinco
herramientas esperadas, comprobando el nombre del servidor. No ejecuta comandos
extraídos de configuraciones de clientes ni crea almacenamiento/habilita esquemas.
El estado propio se muestra como no realizada, en curso, correcta o fallida;
una cancelación vuelve a no realizada. Las sesiones de los cinco clientes siguen
sin probar: reiniciar cada cliente y comprobar allí sus herramientas MCP.
El plazo normal de 5 segundos cubre inicialización, listado y cierre. Al cancelar,
fallar o vencer el plazo se fuerza el cierre del hijo con hasta 250 ms adicionales
para recogerlo. stdout/stderr del hijo no se muestran; errores de prueba son códigos
acotados (`INSTALLATION_REQUIRED`, `CANCELLED`, `TIMED_OUT`, `MCP_FAILED`).

`assistant-list` es JSON de solo lectura, apto para scripts. `tui` necesita stdin
y stdout de terminal; sin ellos devuelve `INTERACTIVE_REQUIRED`. Cancelar devuelve
130. `mcp` reserva stdout para el protocolo, sin escapes del menú ni logs humanos.
`integration-enable` es la alternativa explícita de enrollment sin configurar apps.
`memory-hook` es el adaptador que llaman los hooks nativos; no guarda recuerdos.

Un lanzamiento `bun src/cli.ts tui` debe encontrar un Engram instalado en PATH o
`~/.local/bin`, o informa el requisito. Nunca registra Bun con argumentos `mcp`.
Las rutas de ejecutables registradas son absolutas. No se pide elegir proyectos
durante instalación ni en el menú.

## Instalación y prerrequisitos

macOS/Linux con Bash, Bun >=1.3.8 para compilar y Git disponible. Git también es
necesario para comprobar que una carpeta explícita no es Git; si falta, la
resolución de proyecto falla cerrada con `PROJECT_IDENTITY_UNAVAILABLE`.

La instalación no descarga dependencias ni Git. En un clon nuevo, preparar primero
con `bun install --frozen-lockfile --ignore-scripts`. Si faltan dependencias locales
o no coinciden las versiones declaradas, el instalador muestra ese comando y falla
antes de compilar/publicar. No actualiza silenciosamente `bun.lock`.

Se mantienen `--bin-dir` y `--force`: reemplazar una instalación requiere `--force`.
Después de compilar e instalar se ejecuta detección de solo lectura. En terminal
ofrece abrir el menú; sin terminal no pregunta ni espera, no cambia configuración,
no inicializa base y muestra el comando para usar después.

## Archivos de cliente y copias

Ubicaciones predeterminadas; respetar overrides documentados en el catálogo:

| Cliente | Configuración personal | Hooks/plugin |
| --- | --- | --- |
| Claude Code | `~/.claude.json` | `~/.claude/settings.json` |
| Codex | `~/.codex/config.toml` | `~/.codex/hooks.json` |
| Cursor | `~/.cursor/mcp.json` | `~/.cursor/hooks.json` |
| OpenCode | `~/.config/opencode/opencode.json` o JSONC existente | `plugins/forge614-engram.js` en fuente global activa |
| Gemini CLI | `~/.gemini/settings.json` | `hooks` en el mismo archivo |

Los adaptadores preservan entradas ajenas y comentarios JSONC/TOML. No reemplazan
entradas Engram incompatibles ni políticas que deshabiliten hooks/MCP. Crean
archivos y copias privadas 0600 y directorios nuevos 0700; cada copia contiene los
bytes anteriores exactos y tiene sufijo UUID. Los originales se comparan antes
de aplicar y antes de reemplazar. Después de publicar se vuelve a leer el archivo
con las comprobaciones de seguridad y se comparan los bytes exactos planificados.
Si cambió o ya no se puede leer con seguridad, se informa `PUBLISHED_UNVERIFIED`
y «Publicado sin verificar». `ConfigurationResult.appliedPaths` enumera todas las
publicaciones, incluidas esas rutas; `unverifiedPaths` identifica ese subconjunto,
`backupPaths` conserva las copias y `ok` es falso. Se detiene la aplicación de ese
plan y no se restaura sobre posibles cambios externos. Los resultados públicos
contienen rutas y mensajes seguros, nunca contenido. No es una transacción multifichero ni una garantía
atómica frente a cualquier proceso externo. No hay borrado/rollback automático.
Se rechazan enlaces simbólicos de usuario y archivos inseguros, enormes o inválidos.

OpenCode puede combinar fuentes activas. Un `OPENCODE_CONFIG_DIR` adicional no
sustituye la fuente XDG. Fuentes ambiguas requieren selección explícita de archivo
con la API de adaptadores; el menú ofrece directorio, no un editor general para
resolver fuentes contradictorias. No se añade un plugin duplicado. Un override
de contenido se señala sin leer ni mostrar su valor.

## Esquema, proyectos y memoria

Se conserva una configuración `~/.forge614/.env` y una base
`~/.forge614/engram.db` para todos los proyectos y shared. El esquema 5 es aditivo:
añade/valida metadatos de sincronización y `project_bindings`; no borra recuerdos,
reconstruye bases ni hace downgrade. Un binario antiguo puede rechazar esquema 5.
El servidor MCP no migra al arrancar; habilitar explícitamente antes de usarlo.

MCP expone `memory_current_project`, `memory_search`, `memory_get`, `memory_save`
y `memory_history`. Resolver/consultar no crea proyectos; el primer guardado puede
crear proyecto, asociación y recuerdo de forma atómica. Los directorios anidados
y worktrees vinculados comparten la identidad del directorio Git común. Las rutas
se canonicalizan. Directorios sin Git requieren ruta explícita o raíz MCP única;
no se adivina proyecto a partir de la carpeta del ejecutable ni múltiples raíces.

Los clones en otro equipo conservan UUID por sincronización, pero las rutas locales
no se sincronizan. Cuando un nombre coincide o la identidad es ambigua, usar
`project-bind` con el UUID correcto: no fusionar por nombre. Antes de crear una
identidad para una carpeta desconocida, se revisan únicamente las rutas ya
registradas. Si todas las asociaciones de cualquier proyecto están ausentes o
no se pueden comprobar, se devuelve `PROJECT_BINDING_REQUIRED`, aunque el nombre
nuevo sea distinto. Esto también bloquea conservadoramente carpetas nuevas no
relacionadas mientras exista esa ambigüedad. Recuperar el proyecto movido con
`project-list` y `project-bind --directory /ruta/nueva --project-id UUID`; si es
un proyecto realmente nuevo, crearlo explícitamente con `project-create --name`
y vincular su UUID permite resolverlo sin adivinar. No se escanea el disco.
Si se recrea la ruta antigua, las rutas por sí solas no permiten reconocer de
forma fiable la carpeta movida; hace falta vinculación explícita y más evidencia
de identidad para distinguir ese caso automáticamente. Los snapshots incluyen
memorias, historial y datos de sincronización, nunca asociaciones de rutas.
Importar cambios actualiza FTS local y conserva las asociaciones propias del equipo.

El protocolo pide buscar antes de repetir investigación y guardar conocimiento
duradero, con proyecto como scope predeterminado. `shared` requiere intención
global explícita y una explicación `globalIntent`; no se infiere solo por palabra
clave. Temas se actualizan con `expectedVersion`; reintentos conservan `requestKey`.
No guardar secretos, transcripciones, logs crudos ni salidas completas de herramientas.

## Cobertura exacta y límites

| Cliente | Eventos con guía de memoria | Límites |
| --- | --- | --- |
| Claude Code | `SessionStart`, `UserPromptSubmit` | Depende de permisos/políticas y del modelo |
| Codex | `SessionStart`, `UserPromptSubmit` | Revisar y confiar en hooks nuevos mediante `/hooks` |
| Cursor | `sessionStart` | Solo sesión; sin hook de prompt/compactación verificado |
| OpenCode | `experimental.chat.system.transform`, `experimental.session.compacting` | Callbacks experimentales de plugin |
| Gemini CLI | `SessionStart`, `BeforeAgent` | Sin garantía de callback posterior a compactación |

Se respetan políticas personales detectadas y se avisa de políticas gestionadas
o de confianza no exhaustivamente inspeccionables. No se habilita confianza ni se
sortean restricciones. Los recordatorios sugieren recuperación tras compactación
y un resumen de procedimiento al cierre normal cuando hay valor duradero; el
modelo puede omitir llamadas MCP. No hay captura de transcript, hook Stop en bucle,
LLM independiente ni resumen al cierre garantizado, especialmente tras cierre brusco.

PostgreSQL sigue siendo réplica opcional. `sync-watch` es un proceso separado en
primer plano que debe continuar abierto; el menú no instala un servicio ni lo
arranca. SQLite y FTS5 siguen locales.

## Verificación y entrega documental

Las pruebas usan directorios y datos sintéticos; no configuraciones ni recuerdos
personales. Hay fixtures JSON/JSONC/TOML, streams y PTY real con `/usr/bin/expect`:
binario compilado, cancelación desde vista previa, Escape, restauración exacta
`stty`, instalador interactivo opt-in, y modo no interactivo sin almacenamiento.
La autoprueba cubre el ejecutable compilado con SDK real, errores sin filtraciones,
plazo de inicio y de cierre, y cancelación/EOF/error de entrada con proceso hijo.
Las pruebas PTY se omiten explícitamente donde no existe ese ejecutable.
No se ha probado ejecución de hooks en sesiones reales de los cinco clientes.

Comandos de verificación: `bun test`, `bun run typecheck`, `git diff --check`.
Verificación final del controlador, 2026-09-17: 191 pruebas aprobadas, 0 fallos,
1133 aserciones y 16 archivos de pruebas, en 28.31 s. Se habilitó PostgreSQL real
aislado con `FORGE614_TEST_POSTGRES_BIN`; no hubo pruebas omitidas. Se ejecutaron
las pruebas de MCP compilado, hooks, autoprueba y terminal real. Typecheck y
comprobación de espacios finalizaron con código 0. Esto no prueba sesiones reales
de los cinco asistentes.
Para PostgreSQL real aislado, establecer `FORGE614_TEST_POSTGRES_BIN` a un directorio
de binarios de pruebas. No usar bases ni URLs del usuario. El reporte de Task 3
registra resultados exactos; el controlador añadirá totales finales tras revisión.

```text
Actualiza docs/es/, docs/en/ y Notion para la Entrega 08, usando este handoff,
el código y las pruebas como fuentes. Escribe documentación detallada en inglés
y español en carpetas separadas (docs/en/ y docs/es/). Mantén ambos idiomas
equivalentes y la navegación. Usa lenguaje cotidiano, introduce los términos
técnicos entre paréntesis y añade ejemplos prácticos paso a paso. Actualiza
instalación/prerrequisitos, CLI, arquitectura, SDK, errores,
glosario y roadmap. No modifiques código ni pruebas y no hagas commit/push.

Documenta tui y sus teclas, detección vs configuración vs sesión probada, rutas,
copias, preflight, verificación posterior y fallos parciales/publicado sin verificar.
Explica la autoprueba opcional del servidor, su plazo y cancelación, y que no prueba
sesiones reales de clientes. Explica instalación sin descargas automáticas,
bun install --frozen-lockfile --ignore-scripts, Git obligatorio y binario sin Bun.
No pidas seleccionar proyectos en instalación/setup/tui.

Explica esquema 5 aditivo sin downgrade, bindings locales, worktrees/clones,
ambigüedad, bloqueo conservador de carpetas desconocidas, recuperación mediante
project-bind y límite de ruta antigua recreada; project por defecto y shared solo
con intención global.
Enumera las cinco herramientas MCP y cobertura exacta de eventos por cliente.
Destaca /hooks y confianza de Codex, políticas bloqueantes y límites de modelos.
No prometas conexión probada, guardado infalible, captura de transcript, modelo
independiente, resumen garantizado ni servicio permanente de sync-watch.

Retira afirmaciones obsoletas de que MCP/identificación de proyectos están
pendientes. Conserva honestamente funciones aún pendientes y límites de fixtures
frente a sesiones reales. Usa resultados de pruebas realmente ejecutadas y no
copies secretos. Si Notion no está disponible, informa lo pendiente sin afirmar
que se actualizó. Entrega archivos/páginas modificados y limitaciones.
```
