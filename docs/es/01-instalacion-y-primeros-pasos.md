# 01. Instalación, Configuración y Primeros Pasos

> **Etapa:** Hogar Propio de Producto (`~/.forge614/engram/`), Migración Segura de Espacio Anterior, Desinstalación Protegida (`uninstall`), Centro de Control TUI, FTS5 Reforzado (sin embeddings), Monolito Modular por Funcionalidad, Sesiones de Memoria Progresiva, Contexto Clasificado, 10 Herramientas MCP, Memoria Local y Sincronización PostgreSQL Opcional
> **Esquemas:** SQLite Esquemas 3 (local) / 4 (sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas) / 7 (confirmaciones inmutables y orden reforzado) | Réplica PostgreSQL Formatos 1, 2 y 3 (promoción explícita con `sync --upgrade-format`; tabla física remota `state.format = 1`)
> **Habilitaciones:** Explícitas y aditivas (`integration-enable` para Esquema 5; `sessions-enable` para Esquema 6; `reinforcement-enable` para Esquema 7; `sync --upgrade-format` para réplica Formato 2 o Formato 3). La apertura de base, el centro de control TUI y los comandos ordinarios nunca migran automáticamente.
> **Estado:** Vigente y Verificado (572 superadas, 15 omitidas de plataforma/PG local, 0 fallos, 2786 aserciones en 90 archivos en macOS ARM64 con Bun 1.3.8; validación de release para 6 ejecutables nativos en GitHub Actions)
> **Traducción hermana:** [01 (EN). Installation, Setup, and Getting Started](../en/01-installation-and-getting-started.md)

Esta guía explica paso a paso cómo instalar el comando `forge614-engram`, usar el asistente interactivo `setup`, conectar asistentes con aprobación explícita, trabajar con sesiones progresivas y confirmaciones inmutables de FTS5, y coordinar equipos pares.

---

## 1. ¿Qué es este programa y cómo se distribuye?

Forge614 Engram es un sistema de memoria personal y local para modelos de inteligencia artificial y desarrolladores, construido en **TypeScript y Bun**, con un componente nativo mínimo de seguridad para Windows. En la versión 1.1.0, Engram reside en su propio hogar de producto aislado (`~/.forge614/engram/`), conviviendo armónicamente dentro del contenedor familiar `~/.forge614/` junto a productos hermanos como Forge614 Shell y Forge614 Atlas sin alterar sus carpetas.

### Métodos de Distribución

A diferencia de los paquetes públicos de internet:
- **No se descarga desde npm:** `npm install forge614-engram` no existe porque se trata de un paquete privado y autónomo.
- **Instalación oficial mediante instalador de bootstrap (Recomendada):** Descarga el binario autónomo precompilado correspondiente a tu sistema y arquitectura desde GitHub Releases, verifica su integridad criptográfica contra `SHA256SUMS`, lo coloca en `~/.forge614/engram/bin/` y configura automáticamente el PATH de tu terminal.
- **Compilación local desde código fuente (Desarrolladores):** Se puede empaquetar directamente desde el código fuente del repositorio clonado mediante `bash scripts/install-from-source.sh`.
- **Produce un ejecutable binario autónomo:** El resultado es un único archivo binario independiente llamado `forge614-engram` (o `forge614-engram.exe` en Windows). Una vez instalado, **el usuario final no requiere tener Bun, Node.js, Python ni compiladores de C++** para su ejecución habitual.

### Requisitos del Sistema para el Usuario Final

1. **Git (solo necesario para identidad de proyecto):**
   Git **no es necesario para instalar Forge614 Engram, inicializar su memoria global ni conectar un asistente**. Se necesita después únicamente cuando Engram identifica una carpeta de proyecto y sus *worktrees* mediante `git rev-parse --path-format=absolute --git-common-dir`. Si Git no está disponible, la resolución específica de proyectos se detiene de forma segura con `PROJECT_IDENTITY_UNAVAILABLE`; el instalador no se ve afectado.
   ```bash
   git --version
   ```

2. **Cero herramientas de desarrollo para la instalación estándar:**
   El usuario final que instala mediante los comandos oficiales **no necesita instalar Bun, Node.js, Python, node-gyp ni Visual Studio Build Tools**. El ejecutable binario incluye todas sus dependencias y el componente nativo de Windows incrustado.

3. **Requisitos exclusivos para desarrolladores (compilación desde fuente):**
   - **Bun (versión estable >= 1.3.8):** Requisito exclusivo para compilar desde fuente o ejecutar la suite de pruebas automatizadas (`bun test`).
   - **Windows Build Tools (solo compilación desde fuente en Windows):** Requiere Visual Studio 2026 C++ Build Tools, Node.js 22+, node-gyp 12.1.0 y Python 3.12+ para compilar el módulo nativo C++ `windows_reparse_guard.node`.

4. **Servidor PostgreSQL (Opcional):**
   Únicamente si decides habilitar la sincronización de réplica. Se requiere PostgreSQL 14 o superior. El usuario debe contar con privilegios para crear y escribir en el esquema `forge614_sync`. Debe emplearse una base de datos vacía y dedicada o una ya compatible con Forge614.

---

## 2. Instalación Oficial y Verificación Criptográfica

### Comandos Oficiales de Instalación

Los comandos oficiales de instalación desde GitHub Releases son:

#### En macOS y Linux (Bash / Zsh):
```bash
curl -fsSL https://github.com/jotredev/forge614-engram/releases/latest/download/install.sh | bash
```

#### En Windows (PowerShell):
```powershell
irm https://github.com/jotredev/forge614-engram/releases/latest/download/install.ps1 | iex
```

> [!NOTE]
> **Disponibilidad de Release:** Los instaladores oficiales descargan la última GitHub Release pública (o una versión específica si se indica `--version <tag>` en Unix o `-Version <tag>` en Windows) y verifican el hash SHA-256 del binario contra el manifiesto `SHA256SUMS` antes de colocarlo en el sistema.

### Probar la prerelease `1.1.0-beta.1`

`latest` continúa significando la versión estable. Para probar esta prerelease de forma explícita, usa:

```bash
curl -fsSL https://github.com/jotredev/forge614-engram/releases/download/v1.1.0-beta.1/install.sh | bash
```

```powershell
irm https://github.com/jotredev/forge614-engram/releases/download/v1.1.0-beta.1/install.ps1 | iex
```

### ¿Qué realiza exactamente el instalador oficial?

1. **Detección automática de plataforma y arquitectura:** Detecta automáticamente el sistema operativo y arquitectura de tu equipo (macOS ARM64/x64, Linux x64/ARM64, Windows x64/ARM64).
2. **Descarga y verificación criptográfica íntegra:** Descarga el binario autónomo y el manifiesto oficial `SHA256SUMS`. Calcula el hash SHA-256 localmente y aborta de inmediato si existe cualquier discrepancia, impidiendo la ejecución de binarios alterados o descargas truncadas.
3. **Publicación atómica en el hogar de producto de Engram:**
   - **macOS / Linux:** `$HOME/.forge614/engram/bin/forge614-engram` con permisos de ejecución `0755` sobre el binario, y permisos restringidos `0700` sobre las carpetas propias `~/.forge614/engram/` y `bin/`. Engram no aplica `chmod` al contenedor compartido `~/.forge614/`.
   - **Windows:** `%USERPROFILE%\.forge614\engram\bin\forge614-engram.exe`.
4. **Protección contra sobreescritura accidental:** Si el archivo ya existe en el destino, el instalador se detiene para evitar sobrescribir ejecutables existentes sin tu permiso. Para actualizar una instalación previa, suministra la opción de forzado:
   ```bash
   # En macOS / Linux
   curl -fsSL ... | bash -s -- --force
   # En Windows
   & { irm ... | iex } -Force
   ```
   *(Nota: `--force` / `-Force` actualiza únicamente el archivo binario ejecutable; jamás altera tus recuerdos en `engram.db` ni tu configuración `.env`).*
5. **Directorio personalizado:** Si deseas instalar en otra carpeta:
   ```bash
   # En macOS / Linux
   curl -fsSL ... | bash -s -- --bin-dir /ruta/a/bin
   # En Windows
   & { irm ... | iex } -BinDir C:\MiRuta\bin
   ```
6. **Configuración automática e idempotente de la variable PATH:** Configura la variable PATH de tu terminal (ver Sección 3).
7. **Cero almacenamiento prematuro:** El instalador prepara la carpeta de binarios pero **jamás inicializa la base de datos ni crea `.env` prematuramente** durante la instalación. Ese paso se realiza deliberadamente durante el flujo de bienvenida (`setup`) o inicialización (`init`).

### Opción alternativa: Compilación desde código fuente (Desarrolladores)

Si eres colaborador del proyecto y deseas compilar desde un clon local:

```bash
cd /Users/jorgeetrejoo/Desktop/forge614-engram
bun install --frozen-lockfile --ignore-scripts
bash scripts/install-from-source.sh
```

---

## 3. Configurar tu Terminal (La Variable PATH)

### ¿Qué es la variable PATH en lenguaje cotidiano?

La variable **PATH** (ruta de búsqueda) es como la libreta de direcciones rápidas de tu sistema operativo. Cuando escribes `forge614-engram` en la consola, el sistema operativo no adivina dónde está guardado el programa: consulta una por una las carpetas anotadas en tu lista de PATH. Si la carpeta donde se instaló el programa está en esa lista, el comando se ejecuta de inmediato desde cualquier ubicación sin tener que escribir su ruta completa (como `$HOME/.forge614/engram/bin/forge614-engram`).

### Publicación Automática e Idempotente de PATH

Los instaladores configuran automáticamente el directorio de ejecutables en tu entorno de terminal según tu sistema y shell:

| Plataforma / Shell | Destino del ejecutable | Método de publicación de PATH |
| :--- | :--- | :--- |
| **macOS / Linux, Zsh** | `$HOME/.forge614/engram/bin` | Bloque marcado en `~/.zshrc` |
| **Linux, Bash** | `$HOME/.forge614/engram/bin` | Bloque marcado en `~/.bashrc` |
| **macOS, Bash** | `$HOME/.forge614/engram/bin` | Bloque marcado en `~/.bash_profile`, salvo que otro archivo de inicio de Bash ya sea el responsable; entonces muestra una guía manual |
| **macOS / Linux, Fish** | `$HOME/.forge614/engram/bin` | Archivo dedicado `~/.config/fish/conf.d/forge614-engram.fish` mediante bloque condicional seguro |
| **Windows (PowerShell / CMD)** | `%USERPROFILE%\.forge614\engram\bin` | Variable PATH del usuario vía API .NET y difusión de `WM_SETTINGCHANGE` |

#### Características de Seguridad de la Publicación de PATH:
- **Bloques delimitados en Unix (Bash / Zsh):** En Zsh y Bash, el instalador escribe un bloque claramente delimitado con verificación previa para no duplicar entradas:
  ```bash
  # >>> forge614-engram PATH >>>
  case ":$PATH:" in
    *:"$HOME/.forge614/engram/bin":*) ;;
    *) export PATH="$HOME/.forge614/engram/bin:$PATH" ;;
  esac
  # <<< forge614-engram PATH <<<
  ```
  Si reinstalas o actualizas, el bloque existente se reemplaza limpiamente sin duplicar líneas y preservando el 100% del contenido ajeno de tu archivo de configuración.
- **Bloques delimitados en Fish:**
  ```fish
  # >>> forge614-engram PATH >>>
  if not contains -- "$HOME/.forge614/engram/bin" $PATH
    set -gx PATH "$HOME/.forge614/engram/bin" $PATH
  end
  # <<< forge614-engram PATH <<<
  ```
- **Preservación de enlaces simbólicos y dotfiles personalizados:** Si un archivo de inicio es un enlace simbólico o pertenece a un gestor de dotfiles, el instalador no lo reemplaza ni lo sigue. Lo deja intacto, conserva el ejecutable verificado y muestra instrucciones claras para agregar el directorio manualmente. En Bash de macOS también evita crear `~/.bash_profile` cuando `~/.bash_login` o `~/.profile` ya controlan el inicio de sesión.
- **Windows seguro sin `setx`:** En Windows, el instalador modifica exclusivamente la variable PATH del **usuario actual** utilizando la API oficial de .NET (`[Environment]::SetEnvironmentVariable('Path', ..., 'User')`). No requiere privilegios de Administrador, no toca el PATH de la máquina, no usa la utilidad obsoleta `setx` (la cual trunca rutas a 1024 caracteres provocando pérdida de rutas del sistema), normaliza mayúsculas/minúsculas y diagonales para no añadir entradas duplicadas, y difunde el mensaje de sistema `WM_SETTINGCHANGE` para que las aplicaciones del entorno detecten la actualización.
- **Requisito indispensable:** La variable PATH se actualiza para **nuevas sesiones de terminal**. Para que el comando esté disponible, debes **abrir una nueva ventana de terminal** (o ejecutar la instrucción manual de exportación impresa por el instalador en la sesión actual).

---

## 4. Comprobar la Instalación

Comprueba la versión instalada y la ayuda general sin tocar el disco ni crear archivos:

```bash
# Comprobar la versión instalada
forge614-engram --version
# Salida beta esperada: forge614-engram 1.1.0-beta.1

# Consultar la ayuda oficial
forge614-engram help
```

### Salida oficial de `forge614-engram help`:
```text
Forge614 Engram — una base, recuerdos por proyecto y compartidos

Uso: forge614-engram <comando> [opciones]

setup           Asistente interactivo; confirma antes de guardar. Cancelar no aplica cambios.
tui             Centro de control local. Asistentes con vista previa y confirmación explícita.
init            Inicializa una sola configuración y base local, sin borrar datos.
uninstall       --confirm <frase exacta>; elimina solo Engram tras confirmación explícita.
sync [--upgrade-format]
                Sincroniza todo; --upgrade-format promueve al formato local habilitado (hasta 3).
sync-watch      Reintenta mientras esté abierto [--interval <1..3600 segundos>, defecto 30].
integration-enable  Habilita explícitamente MCP y asociaciones locales (esquema 5).
sessions-enable Habilita explícitamente sesiones (esquema 6).
reinforcement-enable
                Habilita explícitamente repeticiones y orden reforzado (esquema 7).
mcp             Inicia el servidor MCP local por stdio; no migra la base.
assistant-list  Detecta asistentes y muestra configuración/cobertura sin escribir archivos.
memory-hook     --client <claude-code|codex|cursor|opencode|antigravity>
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

Una configuración: ~/.forge614/engram/.env. Una base SQLite: ~/.forge614/engram/engram.db.
No hay conexiones, carpetas .env ni bases diferentes por proyecto.
--db, --project y --id-project no se admiten. El identificador se llama projectId.
project-create inicializa el espacio si aún no existe configuración.
Para guardar shared sin crear un proyecto, ejecuta init primero.
init y setup pueden mover la ubicación antigua de Engram a ~/.forge614/engram cuando es seguro; nunca reemplazan datos en conflicto.
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
uninstall requiere REMOVE FORGE614-ENGRAM; si Atlas existe requiere REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS.
La resolución de directorios de proyecto requiere Git disponible, incluso para carpetas sin Git.
```

---

## 5. Inicializar el Espacio Central: El Asistente `setup`

Para crear tu espacio central por primera vez o reconfigurarlo interactivamente, ejecuta:

```bash
forge614-engram setup
```

El asistente requiere terminal interactiva (`stdin` y `stdout`). Presenta una pantalla paso a paso:

```text
=== Asistente de configuración de Forge614 Engram ===

Este asistente configurará el espacio de trabajo local en:
  Configuración : /Users/usuario/.forge614/engram/.env
  Base de datos : /Users/usuario/.forge614/engram/engram.db

¿Quieres habilitar la sincronización con una base de datos PostgreSQL?
No
Sí, configurar PostgreSQL
Elige [si/NO]:
```

### Arquitectura de Hogar Propio de Producto (`~/.forge614/engram/`)

A partir de la versión 1.1.0, Forge614 Engram deja de almacenar archivos directamente en la raíz de `~/.forge614/`. La estructura de carpetas familiar se organiza de la siguiente manera:

```text
~/.forge614/                       ← Contenedor compartido familiar de Forge614
  shell/                           ← Pertenece a Forge614 Shell; Engram nunca lo modifica ni elimina
  atlas/                           ← Pertenece a Forge614 Atlas; Engram nunca lo modifica ni elimina
  engram/                          ← Pertenece exclusivamente a Forge614 Engram (permisos 0700)
    bin/
      forge614-engram              ← Binario ejecutable en macOS / Linux (permisos 0755)
      forge614-engram.exe          ← Binario ejecutable en Windows
    .env                           ← Configuración única y secreta de Engram (permisos 0600)
    engram.db                      ← Base de datos SQLite única de Engram (permisos 0600)
    engram.db-wal                  ← Diario de transacciones WAL de SQLite
    engram.db-shm                  ← Archivo de memoria compartida de SQLite
    .config-lock                   ← Cerrojo de concurrencia para modificaciones seguras
```

- **Contenedor compartido:** La carpeta `~/.forge614/` pertenece al ecosistema general Forge614. Engram respeta estrictamente a sus hermanos (`shell/`, `atlas/`) y jamás los borra, renombra ni escanea.
- **Aislamiento de producto:** Engram administra única y exclusivamente su subdirectorio `~/.forge614/engram/`.
- **Base de datos única:** Todos los proyectos residen en `~/.forge614/engram/engram.db`. Cada proyecto se aísla lógicamente mediante su identificador `projectId`. Las notas de alcance compartido (`shared`) conviven en esta misma base sin requerir bases separadas.

### Migración Automática y Segura desde Ubicaciones Anteriores

Si ya contabas con una instalación anterior que guardaba sus datos directamente dentro de `~/.forge614/`, tanto `setup` como `init` ejecutan automáticamente un procedimiento de migración no destructiva (`EngramProductHome.migrateLegacyWorkspace`):

1. **Archivos reconocidos:** Únicamente traslada los nombres de archivo exactos de Engram situados directamente en la raíz de `~/.forge614/`: `.env`, `engram.db`, `engram.db-wal`, `engram.db-shm` y `.config-lock`. Jamás toca carpetas ni archivos no reconocidos.
2. **Inspección de seguridad antes de mover:**
   - Si algún archivo antiguo o la carpeta contenedora es un enlace simbólico (*symlink*) o pertenece a otro usuario del sistema operativo, el proceso se aborta de inmediato con el error `LEGACY_UNSAFE`.
   - Si existen archivos de diario `engram.db-wal` o `engram.db-shm` huérfanos sin la base principal `engram.db`, aborta con `LEGACY_CONFLICT` para evitar corrupción de datos.
   - Si el directorio de destino `~/.forge614/engram/` ya contiene archivos que colisionarían con los archivos antiguos, aborta con `LEGACY_CONFLICT` protegiendo ambos conjuntos de datos.
3. **Movimiento atómico con reversión:** Si ocurre un fallo inesperado del sistema de archivos a mitad de la mudanza, Engram revierte atómicamente los archivos ya movidos a su ubicación original y emite el error `LEGACY_MIGRATION_FAILED` para no dejar el estado a medias.

### Reparación Automática de Permisos Privados (`0700` y `0600`)
Antes de leer la configuración o formular preguntas interactivas, `setup` valida el contenedor compartido `~/.forge614/` sin modificarlo y después inspecciona la carpeta propia `~/.forge614/engram/`. Si esa carpeta de producto existe, es ordinaria y pertenece al usuario actual, Engram puede restringir sus permisos a `0700` (`rwx------`).
- **¿Por qué son indispensables los permisos `0700` y `0600`?** La carpeta central contiene recuerdos personales, la base de datos SQLite `engram.db`, diarios WAL y potencialmente credenciales de conexión a PostgreSQL en `.env`. Los permisos `0700` en carpetas y `0600` en archivos garantizan que únicamente el usuario dueño de la cuenta pueda acceder a estos datos, bloqueando a cualquier otro usuario local de la máquina.
- **Sin necesidad de `chmod`:** Los usuarios finales no necesitan comprender los permisos octales de UNIX ni ejecutar manualmente comandos como `chmod 0700 ~/.forge614/engram`.
- **Límites estrictos de seguridad (*Fail-Closed*):** Esta reparación automática está intencionadamente limitada a directorios ordinarios propiedad del usuario actual. No crea carpetas si no existían en verificaciones pasivas, nunca repara ni sigue enlaces simbólicos (*symlinks*), y rechaza de inmediato rutas que no sean directorios, que pertenezcan a otros usuarios o cuyos permisos finales no puedan asegurarse.

### Opciones de Sincronización
- **Opción `No` (Predeterminada):**
  Presionar Enter o escribir `no` opera de manera 100% local e independiente. Si PostgreSQL ya estaba configurado, elegir `No` lo desactiva sin borrar ninguna copia previa.
- **Opción `Sí, configurar PostgreSQL`:**
  Si eliges `sí`, el asistente solicita la URL de conexión de forma confidencial con **entrada oculta en pantalla** (`{ secret: true }`). La contraseña que escribas no se mostrará ni en texto claro ni con asteriscos, protegiendo tus credenciales de miradas indiscretas.

### Oferta de Refuerzo de Búsqueda FTS5 (Esquema 7)
A continuación, el asistente pregunta si deseas activar el refuerzo de búsqueda por repeticiones:

```text
registrar repeticiones mejora el orden; no verifica la verdad.
sincronizar esta función requiere actualizar todos los equipos.
¿Quieres habilitar el refuerzo de recuerdos? [si/NO]
```

- **Por defecto es `NO`:** Presionar Enter no activa el refuerzo.
- **Si respondes `sí`:** Se registrará para habilitar el Esquema 7 tras la confirmación final.
- **Si el refuerzo ya estaba activo:** El asistente informa: *"El refuerzo de recuerdos ya está habilitado. Se conservará habilitado; esta configuración no ofrece una degradación."* y no ofrece un desmantelamiento ficticio.

### Resumen y Confirmación Previa
Antes de escribir un solo byte en el disco, el asistente muestra un resumen claro del plan y pide confirmación explícita:

```text
Resumen: configurar el almacenamiento global SQLite y mantener habilitado el refuerzo de recuerdos. No se crearán ni seleccionarán proyectos y no se borrarán datos.
¿Confirmar? [si/NO]:
```

### Transición Automática al Selector de Asistentes (Onboarding TUI)

Una vez confirmada y aplicada la inicialización de memoria, `setup` cierra de forma limpia su lector de terminal (`readline`) y **abre automáticamente el Centro de Selección de Asistentes (`assistantTui`)** para completar tu incorporación:

1. **Detección exhaustiva de los 5 asistentes soportados:** Inspecciona la presencia y configuración de:
   - **Claude Code** (`claude-code`)
   - **Codex** (`codex`)
   - **Cursor** (`cursor`)
   - **OpenCode** (`opencode`)
   - **Antigravity** (`antigravity`)
2. **Cero modificaciones silenciosas:** El instalador y el comando `setup` **jamás alteran la configuración de ningún asistente sin tu autorización explícita**. Encontrar un asistente en tu máquina no escribe ni modifica archivos automáticamente.
3. **Vista previa completa y detallada:** Puedes seleccionar o deseleccionar qué asistentes deseas integrar (usando la barra espaciadora o la autoprueba `t`). Antes de tocar el disco, el asistente presenta un plan pormenorizado que detalla:
   - Rutas exactas de archivos de configuración a modificar.
   - Entradas del servidor MCP `forge614-engram` que se añadirán o verificarán.
   - Ganchos (*hooks*) de memoria que se registrarán o advertencias de ausencia de hooks (como en Antigravity).
   - Copias de seguridad automáticas con sufijo privado `.forge614-backup-<UUID>` con permisos estrictos `0600`.
4. **Confirmación explícita indispensable:** Solo tras tu confirmación manual final se aplican los cambios a los archivos de configuración mediante el protocolo protegido de escritura atómica.

### Semántica Estricta de Cancelación

El flujo de incorporación `setup` maneja la cancelación de forma independiente y segura en cada fase:
- **Cancelación durante la configuración de memoria:** Si presionas `Ctrl+C`, `Escape` o respondes `no` antes de confirmar la memoria:
  - El comando finaliza de inmediato con código de salida **130** (*Cancelled*).
  - **No se abre la TUI de asistentes.**
  - **No se crea `.env`, `engram.db`, proyectos ni recuerdos:** Si `~/.forge614/` no existía, permanece inexistente. Si ya existía, Engram sólo lo valida y no cambia sus permisos; ningún archivo adicional es creado.
- **Cancelación o salida en la TUI de asistentes:** Si completaste y confirmaste la configuración de memoria pero decides salir o cancelar el selector de asistentes:
  - El espacio de memoria inicializado **se conserva intacto** en `~/.forge614/`.
  - No se revierte ni se destruye la base de datos recién configurada.
  - La salida no se convierte en un error; el comando termina con código `0` de forma segura.

### Distinción Clave entre Comandos de Inicialización

Para evitar confusiones operativas:

| Comando | Tipo de Interfaz | ¿Configura Memoria (`~/.forge614`)? | ¿Detecta o Conecta Asistentes? |
| :--- | :--- | :--- | :--- |
| **`forge614-engram setup`** | Interactiva (TTY) | Sí (repara permisos de carpeta existente a `0700` antes de preguntar; guiado paso a paso con confirmación) | **Sí:** Abre automáticamente la TUI de asistentes tras configurar memoria |
| **`forge614-engram init`** | No interactiva (Headless / JSON) | Sí (repara permisos existentes a `0700` y crea/verifica almacenamiento en modo silencioso) | **No:** No detecta asistentes ni abre interfaces interactivas |
| **`forge614-engram assistant-list`** | De solo lectura (JSON) | **No:** Jamás crea `.forge614` ni escribe archivos | **Sí (Solo lectura):** Audita ejecutables y estado sin alterar configuraciones |

---

## 6. El Centro de Control Interactivo (`forge614-engram tui`)

Una vez instalado, el comando `forge614-engram tui` abre el **Centro de Control interactivo en terminal**:

```bash
forge614-engram tui
```

### Menú Principal y Navegación
La pantalla superior presenta las secciones disponibles:
```text
Summary | Projects | Shared | Storage | Actions | Assistants | Exit
```
*(En español: Resumen | Proyectos | Shared | Almacenamiento | Acciones | Asistentes | Salir)*

- **Flechas Izquierda / Derecha / Arriba / Abajo:** Mueven el foco y navegan entre opciones y listas.
- **Enter:** Abre la sección o selecciona el elemento enfocado.
- **Escape:** Retrocede a la vista anterior o cancela la acción en curso.
- **PgUp / PgDn:** Desplazan el texto cuando la información excede la altura de la terminal.
- **Ctrl+C o EOF:** Termina la sesión inmediatamente y restaura la terminal a su estado original.

### Principio de Solo Lectura por Defecto
El Centro de Control abre siempre en modo de **estricta lectura**:
- Abrir la pantalla, recorrer sus menús, redimensionar la ventana o ingresar teclas no reconocidas **jamás escribe en el disco**, no crea `~/.forge614/.env`, no crea `engram.db`, no inventa proyectos ni registra carpetas.
- Si el espacio aún no ha sido inicializado, el Centro de Control muestra un mensaje claro explicando que se debe ejecutar `setup` o `init`, sin intentar crear archivos automáticamente.
- Requiere una terminal interactiva real (TTY). En entornos sin TTY (como redirecciones de tuberías o scripts CI sin consola), termina de inmediato arrojando el código seguro `INTERACTIVE_REQUIRED`.

### Información Visible vs. Información Oculta
- **Metadatos Visibles:** Nombres de proyectos, identificadores UUID abreviados en listas y completos en la vista de detalle, fechas de creación y actualización, rutas locales de carpetas vinculadas, contadores de recuerdos activos y archivados, ruta de la base de datos SQLite local, versión de esquema (3 a 7), capacidades activadas y estado de PostgreSQL (`configured` o `not-configured`).
- **Secretos Protegidos:** El Centro de Control **nunca** muestra `POSTGRES_URL`, contenidos del archivo `.env`, contraseñas, secretos, títulos de recuerdos, texto de recuerdos ni contenidos de archivos de configuración de asistentes.
- **Saneamiento Exhaustivo:** Todas las cadenas de texto mostradas en pantalla pasan por un motor de filtrado que neutraliza códigos de escape ANSI maliciosos, caracteres de control, secuencias bidireccionales (bidi), caracteres de ancho cero y URLs no autorizadas.

### Confirmación Estricta de Acciones (`confirm` + Enter)
Para ejecutar cualquier cambio en el sistema desde la pestaña `Actions`:
1. La pantalla muestra una **vista previa completa** de la acción seleccionada y sus consecuencias.
2. Si requiere datos (como el nombre de un nuevo proyecto o una ruta absoluta para asociar), los solicita y valida previamente.
3. El sistema exige escribir explícitamente la palabra `confirm` (sin importar si usas mayúsculas o minúsculas) y presionar Enter.
4. **Presionar solo la tecla Enter jamás autoriza escrituras.**
5. Si presionas Escape o Ctrl+C antes de la confirmación final, la acción se cancela de inmediato y el disco permanece idéntico al estado inicial.

### Subflujo de Asistentes Integrado
Al seleccionar la opción `Assistants`:
- El Centro de Control suspende su pantalla y restaura el modo de la terminal de forma limpia.
- Abre de forma secuencial el configurador de asistentes existente (`assistantTui`), permitiendo seleccionar editores, realizar la autoprueba de 5 segundos, previsualizar los cambios y aplicarlos con respaldos de seguridad.
- Al salir del configurador de asistentes, la terminal se restaura y el Centro de Control recarga un resumen fresco y actualizado de la base de datos.
- **Cero modos raw anidados:** No existen dos lectores de terminal activos simultáneamente.

---

## 7. Habilitar la Integración de Asistentes (Esquema 5)

Para que los asistentes de inteligencia artificial puedan interactuar con la memoria y registrar asociaciones locales de carpetas a proyectos (`project_bindings`), la base de datos debe encontrarse en **Esquema 5**.

Existen dos vías para habilitar el Esquema 5:

### Vía A: Centro de Control TUI (`tui`)
En `forge614-engram tui`, ve a la pestaña `Actions`, selecciona `Enable assistant integration`, escribe `confirm` y presiona Enter.

### Vía B: Comando Explícito (`integration-enable`)
Si deseas preparar el espacio y habilitar el Esquema 5 desde la línea de comandos:

```bash
forge614-engram integration-enable
```

Salida esperada (en JSON puro):
```json
{
  "enabled": true,
  "schema": 5
}
```

---

## 8. Habilitar el Ciclo de Sesiones Progresivas (Esquema 6)

Para que los asistentes y la terminal puedan crear sesiones de trabajo (`session-start`), consultar líneas temporales (`timeline`), ensamblar contextos clasificados (`context`) y registrar resúmenes estructurados (`session-summary`), la base de datos debe encontrarse en **Esquema 6**.

### Vía A: Centro de Control TUI (`tui`)
En `forge614-engram tui`, ve a `Actions`, selecciona `Enable sessions`, escribe `confirm` y presiona Enter.

### Vía B: Comando Explícito (`sessions-enable`)
```bash
forge614-engram sessions-enable
```

Salida esperada (en JSON puro):
```json
{
  "enabled": true,
  "schema": 6
}
```

### Reglas Críticas de Habilitación de Sesiones:
1. **Nunca hay migración automática:**
   El comando del servidor MCP (`forge614-engram mcp`), la apertura normal de la base de datos (`workspace.open()`), la inicialización (`init`), el listado de proyectos o las búsquedas y lecturas ordinarias **jamás migran automáticamente la base de datos local**. Si intentas usar comandos de sesión en una base sin Esquema 6, el sistema se detiene arrojando el error `MIGRATION_REQUIRED`.
2. **Tablas incorporadas por el Esquema 6:**
   Crea aditivamente las tablas relacionales:
   - `sessions`: Registro inmutable de sesiones de ejecución (*runtime*) y manuales.
   - `session_entries`: Tira cronológica que asocia versiones de recuerdos a sesiones.
   - `session_summaries`: Punteros a los resúmenes estructurados de cada sesión.
   - `local_session_bindings`: Asociaciones locales entre sesiones y carpetas en disco.
   - `local_manual_sessions`: Cuadernos de sesión manual exclusiva por proyecto para este equipo.

---

## 9. Habilitar el Refuerzo de Búsqueda FTS5 (Esquema 7)

Para que el motor de búsqueda SQLite FTS5 incorpore factores de repetición inmutable y estabilidad temporal sin embeddings, la base de datos debe encontrarse en **Esquema 7**.

### Vía A: Centro de Control TUI (`tui`)
En `forge614-engram tui`, ve a `Actions`, selecciona `Enable search reinforcement`, escribe `confirm` y presiona Enter.

### Vía B: Comando Explícito (`reinforcement-enable`)
```bash
forge614-engram reinforcement-enable
```

Salida esperada (en JSON puro):
```json
{
  "enabled": true,
  "schema": 7
}
```

### Reglas Críticas del Refuerzo FTS5:
1. **Habilitación Aditiva y Transaccional:**
   Añade las tablas `confirmations` (con clave primaria UUID `confirmationId`, versión referenciada, fecha UTC y sesión opcional) y `confirmation_requests` (para deduplicación idempotente de peticiones por clave). Si la base de datos se encontraba en Esquemas 3, 4 o 5, encadena automáticamente las migraciones previas en una única transacción atómica (`BEGIN IMMEDIATE ... COMMIT`).
2. **Idempotencia y Protección ante Bases Desaparecidas:**
   Ejecutar `reinforcement-enable` en una base que ya tiene Esquema 7 es una operación segura que devuelve de inmediato el mismo JSON. Sin embargo, si existe un archivo `.env` configurado cuya base `engram.db` fue eliminada del disco, el comando **falla de forma segura** con error; jamás crea una base vacía silenciosa que oculte la pérdida de datos.
3. **No Configura Asistentes Automáticamente:**
   Habilitar el refuerzo no modifica los archivos de configuración de tus asistentes ni sus ganchos. Para actualizar las instrucciones de los asistentes previamente configurados, utiliza la opción `Assistants` del Centro de Control `tui` con su mecanismo seguro de previsualización y respaldo.
4. **Coordinación entre Equipos Pares (*Peer Devices*):**
   Si sincronizas tu memoria con otras computadoras mediante PostgreSQL:
   - Todas las computadoras deben actualizarse a la versión 1.0.0 compatible.
   - En cada equipo par debe ejecutarse `forge614-engram reinforcement-enable` antes de sincronizar datos con confirmaciones. Si un cliente sin refuerzo recibe un snapshot con confirmaciones, aborta con `REINFORCEMENT_REQUIRED`.
5. **Promoción de Réplica PostgreSQL (Formato 1 o 2 a Formato 3):**
   La habilitación local no promueve automáticamente la réplica remota. Para promover la réplica en PostgreSQL y sincronizar eventos de confirmación, se debe ejecutar conscientemente:
   ```bash
   forge614-engram sync --upgrade-format
   ```
   > [!WARNING]
   > `sync-watch` y la acción de sincronización del Centro de Control TUI rechazan terminantemente la promoción de formato. La promoción debe realizarse exclusivamente mediante el comando puntual `sync --upgrade-format` en terminal para asegurar la confirmación consciente del usuario.

---

## 10. Inspección de Asistentes en JSON (`assistant-list`)

Para auditar qué asistentes tienes instalados, qué rutas de configuración utilizan y qué nivel de cobertura de memoria ofrecen sin escribir archivos ni abrir menús interactivos:

```bash
forge614-engram assistant-list
```

Salida representativa en JSON (ideal para scripts de automatización o diagnóstico):
```json
[
  {
    "id": "claude-code",
    "label": "Claude Code",
    "detected": {
      "installed": true,
      "executable": "/usr/local/bin/claude",
      "configFound": true,
      "evidence": ["executable-found", "config-found"]
    },
    "configuration": {
      "status": "configured",
      "paths": [
        "/Users/usuario/.claude.json",
        "/Users/usuario/.claude/settings.json"
      ]
    },
    "automation": {
      "coverage": "session-and-prompt",
      "warnings": [
        "Configuration does not prove a client connection or model compliance. Durable saves depend on the assistant; abrupt termination cannot guarantee a final save.",
        "Managed policies and runtime trust can restrict MCP or hooks; this preview does not change them."
      ]
    }
  },
  {
    "id": "antigravity",
    "label": "Antigravity",
    "detected": {
      "installed": true,
      "executable": "/Users/usuario/.local/bin/agy",
      "configFound": true,
      "evidence": ["executable-found", "config-found"]
    },
    "configuration": {
      "status": "configured",
      "paths": [
        "/Users/usuario/.gemini/config/mcp_config.json"
      ]
    },
    "automation": {
      "coverage": "mcp-only",
      "warnings": [
        "Hooks are unavailable for Antigravity until a compatible official durable-memory event is verified.",
        "Configuration does not prove a client connection or model compliance. Durable saves depend on the assistant; abrupt termination cannot guarantee a final save."
      ]
    }
  }
]
```

### 10.1. Integración con Antigravity

Forge614 Engram soporta oficialmente a **Antigravity** como asistente de desarrollo:

* **Compatibilidad mediante MCP (*Model Context Protocol*):** Antigravity se comunica con Engram a través del protocolo estándar MCP por canales de entrada/salida (`stdio`). Esto le permite consultar el contexto clasificado (`memory_context`), buscar recuerdos relevantes (`memory_search`) y registrar nuevas decisiones (`memory_save`).
* **Decisión del modelo:** Configurar MCP conecta las herramientas con Antigravity, pero **no garantiza que el modelo guarde un recuerdo en cada interacción**. El asistente de inteligencia artificial decide de manera autónoma cuándo invocar las herramientas según las instrucciones de tu conversación.
* **Cobertura actual (*MCP Only*):** Antigravity se configura exclusivamente como **MCP only**. **No se instala ningún hook automático** para Antigravity. Los ganchos de eventos (*hooks*) estarán disponibles en Engram solo si en el futuro existe un evento oficial, compatible y validado para recordatorios duraderos de memoria.
  > [!WARNING]
  > *Hooks are unavailable for Antigravity until a compatible official durable-memory event is verified.*

#### Ubicación del Archivo de Configuración:
En todos los sistemas operativos (macOS, Linux y Windows), Engram administra únicamente el archivo de configuración global de MCP de Antigravity:
```text
~/.gemini/config/mcp_config.json
```

La entrada administrada dentro del archivo tiene la siguiente estructura conceptual:
```json
{
  "mcpServers": {
    "forge614-engram": {
      "command": "/ruta/absoluta/a/forge614-engram",
      "args": ["mcp"]
    }
  }
}
```

* **Ruta absoluta:** La propiedad `command` siempre almacena la ruta absoluta al ejecutable de Engram en tu disco.
* **Argumento único:** `"args": ["mcp"]` es el único argumento pasado al ejecutable.
* **Preservación de claves ajenas:** Engram respeta y conserva todas las claves y configuraciones de otros servidores MCP que ya existan en el archivo JSON.
* **Detección de conflictos:** Si ya existe una entrada para `forge614-engram` con una ruta o argumentos diferentes, Engram **no la sobrescribe a ciegas**; detiene la operación y solicita revisión manual para evitar pérdida de configuraciones personalizadas.
* **Copias de seguridad privadas:** Antes de escribir cambios, Engram crea un respaldo privado (`0600`) identificado por UUID.
* **Verificación posterior:** Engram lee y comprueba los bytes exactos publicados en el archivo antes de reportar éxito.

#### Orden de Detección de Antigravity:
Al auditar el sistema, Engram busca el ejecutable de Antigravity en el siguiente orden estricto:
1. Busca el comando `agy` en las carpetas de tu variable de entorno `PATH`.
2. En macOS y Linux, comprueba la ruta estándar:
   ```text
   ~/.local/bin/agy
   ```
3. En Windows, comprueba la ruta estándar de aplicación local:
   ```text
   %LOCALAPPDATA%/agy/bin/agy.exe
   ```

*(Nota: Encontrar Antigravity no modifica ningún archivo automáticamente. El usuario siempre debe seleccionarlo deliberadamente y confirmar la operación en el asistente `setup` o en el menú `tui`).*

#### Compatibilidad y Protección de Configuraciones Gemini Anteriores:
* Forge614 Engram **ha dejado de administrar Gemini CLI**.
* No realiza migraciones automáticas ni modifica configuraciones antiguas de Gemini.
* Engram **no lee, no modifica y no elimina** el archivo:
  ```text
  ~/.gemini/settings.json
  ```
  Si este archivo existe en tu equipo, permanece completamente intacto.
* El hecho de que Antigravity utilice la carpeta compartida `.gemini` para su configuración no autoriza a Engram a alterar configuraciones previas de Gemini.

#### Seguridad de Rutas en Windows y Componente Nativo:

Forge614 Engram sigue desarrollado principalmente en **TypeScript y Bun**, pero incorpora un componente nativo mínimo exclusivo para Windows en C/C++ (`native/windows-reparse-guard/addon.cc`) para consultar atributos del sistema de archivos de forma directa y atómica:

* **Qué es un componente nativo y por qué se añadió:**
  Un componente nativo (módulo Node-API compilado en formato binario `.node`) es una pequeña biblioteca que se comunica directamente con las funciones del sistema operativo. Se añadió para reemplazar las consultas de seguridad que anteriormente se realizaban ejecutando scripts auxiliares de PowerShell. Invocar PowerShell introducía un retardo considerable (1 a 2 segundos por proceso), lo que provocaba que las comprobaciones de seguridad excedieran los límites de tiempo de las pruebas y abortaran operaciones legítimas por falso positivo. La consulta nativa mediante la API oficial de Windows se ejecuta de manera instantánea (en microsegundos).
* **Qué hace `GetFileAttributesW`:**
  Es la función oficial de la API Win32 provista por `Kernel32.dll` para consultar los atributos de un archivo o carpeta mediante una ruta absoluta en formato de caracteres anchos UTF-16 (*wide string*). Devuelve una máscara de bits con los atributos del sistema de archivos o el valor `INVALID_FILE_ATTRIBUTES` si la ruta no existe, es inaccesible o si ocurre un fallo interno del sistema.
* **Qué indica `FILE_ATTRIBUTE_REPARSE_POINT`:**
  Es la constante de bits oficial de Windows (`0x400`) que identifica si una entrada del sistema de archivos NTFS tiene asignado un punto de reanálisis (*reparse point*).
* **Peligro de redirección (enlaces simbólicos, junctions y puntos de montaje):**
  - **Enlaces simbólicos (*symbolic links*):** Punteros que redirigen transparentemente una ruta de archivo o carpeta hacia otra ubicación arbitraria.
  - **Uniones de directorio (*directory junctions*):** Mecanismo tradicional de NTFS para enlazar carpetas locales sin requerir permisos elevados de administrador.
  - **Puntos de montaje de volumen (*volume mount points*):** Carpetas enlazadas a otra partición o unidad de disco mediante utilidades del sistema como `mountvol.exe`.
  - **Riesgo real:** Si una ruta en apariencia legítima (como `C:\Users\usuario\.gemini\config\mcp_config.json`) o cualquiera de sus carpetas intermedias (como `.gemini` o `config`) apunta a una junction o symlink controlado por un proceso externo, escribir allí redirigiría los datos a un archivo ajeno, pudiendo sobrescribir archivos críticos o alterar configuraciones sin autorización.
* **Recorrido e inspección estricta de componentes existentes:**
  La función de seguridad `assertSafePath` valida primero que la ruta sea absoluta y sintácticamente correcta (`validPath`), y luego asciende recursivamente examinando el archivo destino y cada uno de los directorios padres existentes hasta alcanzar la raíz de la unidad de disco. En Windows, cada componente existente es evaluado por el componente nativo; si cualquiera de ellos posee el atributo `FILE_ATTRIBUTE_REPARSE_POINT`, la operación se aborta de inmediato con el error `UNSAFE_PATH` (*"Configuration paths must not traverse Windows reparse points."*).
* **Política de fallo cerrado (*fail-closed*):**
  Si `GetFileAttributesW` devuelve `INVALID_FILE_ATTRIBUTES`, si el complemento nativo no puede cargarse, o si devuelve un valor que no sea estrictamente el booleano `false`, el sistema **falla cerrado** y lanza inmediatamente el error `UNSAFE_PATH` (*"Could not verify Windows reparse-point safety."*). Jamás se asume que una ruta es segura ante la duda o ante un fallo del comprobador.
* **Límites reales de seguridad:**
  Comprobar los componentes de una ruta antes de usarla previene de forma efectiva la escritura accidental a través de enlaces o uniones preexistentes. Sin embargo, en sistemas de archivos concurrentes, una comprobación previa no constituye una garantía matemática absoluta frente a modificaciones que otro proceso malicioso pudiera realizar exactamente entre el momento de la comprobación y el momento de apertura (*Time-of-Check to Time-of-Use* / TOCTOU). Engram mitiga este riesgo realizando comprobaciones repetidas antes de crear directorios, antes del reemplazo final y mediante una lectura de verificación posterior de los bytes exactos publicados.

#### Protocolo de Escritura Segura de Configuraciones (`guardedWrite`):

El guardado de archivos de configuración (`private-files.ts`) sigue un protocolo riguroso de 10 pasos atómicos:
1. **Inspección de ruta y preexistencia:** Se valida la seguridad de la ruta con `readSafeFile`. Si el archivo ya existe, se comprueba que sea un archivo regular, que no supere el límite de 1 MiB (`MAX_CONFIG_BYTES`), que pertenezca al usuario actual y que su contenido sea UTF-8 válido.
2. **Comparación con la vista previa:** Se comprueba que el contenido actual en disco coincida exactamente con el texto observado durante la vista previa (`write.before`). Si otro proceso modificó el archivo mientras el usuario revisaba la pantalla, se aborta con `CHANGED`.
3. **Creación segura de directorios padres:** Se asegura la existencia del directorio contenedor mediante `mkdirSync` con permisos restringidos (`0700`) y se vuelve a validar inmediatamente la seguridad de la ruta con `assertSafePath`.
4. **Respaldo con identificador único:** Si existía un archivo previo, se crea una copia de seguridad exacta agregando el sufijo `.forge614-backup-<UUID>` con permisos `0600` y modo de creación exclusiva (`flag: 'wx'`).
5. **Creación exclusiva del archivo temporal:** Se genera un archivo temporal único con sufijo `.forge614-tmp-<UUID>` mediante `openSync` utilizando el descriptor seguro `safeOpenFlag`.
6. **Escritura y volcado forzado a disco:** Se escribe el nuevo contenido (`writeFileSync`) y se invoca `fsyncSync` sobre el descriptor para garantizar que los datos se sincronicen físicamente en el disco antes de continuar.
7. **Re-verificación previa al reemplazo:** Se vuelve a leer el archivo original para certificar que no cambió mientras se preparaba el temporal. Si cambió, se detiene con `CHANGED` y se conserva el respaldo original.
8. **Reemplazo atómico:** Tras una nueva validación de ruta, se realiza el reemplazo atómico mediante `io.rename(temporary, write.path)`.
9. **Verificación posterior de bytes (*Post-Publication Verification*):** Se lee de nuevo el archivo publicado con `readSafeFile`. Si su contenido no coincide byte por byte con lo planificado (`write.after`), se arroja `PUBLISHED_UNVERIFIED`. Las copias de respaldo se conservan intactas y no se ejecuta una marcha atrás destructiva que pudiera alterar datos externos.
10. **Limpieza segura:** Si ocurrió algún error antes de publicar el archivo, el bloque `finally` elimina el archivo temporal pendiente con `unlinkSync`.

#### Diferencias de Plataforma en la Apertura de Archivos:
* **Modos textuales en Windows ("r" y "wx"):**
  - Para la lectura segura de archivos, Windows utiliza el modo `"r"` (lectura simple).
  - Para la creación de archivos temporales y respaldos, Windows utiliza el modo `"wx"`. El modificador `"w"` abre para escritura y `"x"` (*exclusive*) exige que el archivo se cree de forma exclusiva: si el archivo ya existía previamente, la llamada falla de inmediato arrojando `EEXIST`.
* **Banderas numéricas en macOS y Linux:**
  - En sistemas Unix, la apertura se realiza con las constantes numéricas bit a bit de POSIX combinadas con la bandera de no seguimiento de enlaces: `constants.O_RDONLY | constants.O_NOFOLLOW` para lectura, y `constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW` con permisos octales `0600` para creación exclusiva.
* **Incidente técnico observado en CI:**
  Durante las pruebas automatizadas en GitHub Actions sobre ejecutores Windows, la creación del archivo temporal mediante la combinación numérica de banderas (`O_WRONLY | O_CREAT | O_EXCL`) devolvía un error de sistema `ENOENT` en el entorno de Bun en Windows. En el mismo archivo, la creación de respaldos ya funcionaba correctamente porque utilizaba el modo textual `{ flag: 'wx' }`. Al unificar la apertura de archivos en Windows bajo la función `safeOpenFlag` para emplear modos textuales (`"r"` y `"wx"`), las operaciones de lectura y creación temporal pasaron exitosamente. *(Nota: no se generaliza que todas las banderas numéricas fallen en Windows ni que Windows carezca de apertura segura; la incompatibilidad residía en la interacción entre Bun y las banderas numéricas en esa llamada concreta).*

#### Construcción del Componente Nativo y Herramientas:
* **Script de compilación (`scripts/build-windows-reparse-addon.ps1`):**
  Orquesta la compilación del addon nativo para las arquitecturas `x64` o `arm64`.
* **Herramientas y versiones fijadas:**
  - **Bun (`>=1.3.8`):** Motor de ejecución principal de TypeScript.
  - **Node.js (`22.14.0` en CI):** Requerido exclusivamente en tiempo de compilación para ejecutar `node-gyp`.
  - **`node-gyp` (`12.1.0` fijado en `devDependencies`):** Herramienta que genera el proyecto MSBuild y compila `addon.cc`. Se fijó en la versión `12.1.0` para garantizar compatibilidad completa simultánea con Node.js 22 y Visual Studio 2026.
  - **Python (`3.12+`):** Utilizado internamente por el motor GYP (`gyp_main.py`).
  - **Visual Studio 2026 Build Tools (versión interna `18`):** Compilador C/C++ oficial de Microsoft en ejecutores `windows-latest`.
* **Resolución segura de `node.exe`:**
  En máquinas virtuales con múltiples instalaciones de Node.js en el PATH, el script implementa `Resolve-NodeExecutable` para filtrar y seleccionar **una única ruta ejecutable válida**, evitando concatenaciones erróneas de comandos.

#### Evidencia de Validación en CI y Pruebas Automatizadas:
* **Ejecución exitosa del flujo Verify en CI:**
  El flujo de trabajo `Verify` en GitHub Actions (**ejecución ID `35427426902`**, commit `f047693b9e27368d104cfc945c0e419af4a1d4b9`) finalizó con resultado exitoso (**Verde / Pass**) en todas sus plataformas (`ubuntu-latest`, `macos-latest` y `windows-latest`):
  - **Ubuntu y macOS:** 543/545 pruebas pasadas (9 de PostgreSQL pasadas con binarios configurados; 0 fallos); validación de sintaxis y fixtures de shells Bash/Zsh/Fish.
  - **Windows x64 nativo:** Validación del guardián nativo, suite `install.ps1.test.ps1` con lectores/escritores de PATH en memoria y comprobación de regresión del smoke test.
* **Validación completa del flujo de empaquetado de Release (`release.yml`):**
  El flujo de empaquetado y distribución (**ejecución manual ID `35427429725`**, y corrida de referencia `35428406085`) validó con éxito (**Verde / Pass**) la construcción y ensamblado de los 6 artefactos de release:
  1. **Incrustación del módulo nativo en Windows x64 y ARM64:** El flujo compila el addon C++ con `scripts/build-windows-reparse-addon.ps1 -Architecture ${{ matrix.addon_architecture }}` antes de invocar `bun build --compile`. Bun incrusta automáticamente el archivo `.node` compilado dentro de los binarios autónomos `forge614-engram-windows-x64.exe` (111,104 bytes de addon) y `forge614-engram-windows-arm64.exe` (110,592 bytes de addon).
  2. **Comprobación de humo reforzada fuera del repositorio (*Strengthened Release Smoke Test*):**
     Anteriormente, `assistant-list` devolvía los 5 identificadores de asistentes incluso ante un fallo de carga del complemento nativo, capturando la excepción y reportando `configuration.status = blocked`. Comprobar solo el código de salida no garantizaba que el addon nativo hubiera cargado en memoria. La validación en CI fue reforzada para exigir que, bajo un perfil temporal aislado (`RUNNER_TEMP`, sin configuración previa), los 5 asistentes devuelvan exactamente un resultado con estado `absent`. Cualquier resultado `blocked`, ausente o duplicado provoca el fallo inmediato del flujo. Ambos ejecutables (`windows-x64` y `windows-arm64`) superaron esta comprobación sin polución residual (cero creación de `~/.forge614/`).
  3. **Ensamblado y sumas criptográficas:** Se generó y validó el archivo `SHA256SUMS` con los 6 binarios de release (macOS x64/ARM64, Linux x64/ARM64, Windows x64/ARM64), confirmando seis comprobaciones `OK`.
  4. **Salvaguarda de publicación:** La ejecución manual mediante `workflow_dispatch` omitió (*skipped*) deliberadamente la publicación de la GitHub Release; la publicación real queda estrictamente reservada para etiquetas oficiales `v*`.
* **Verificación de la suite local de pruebas:**
  La suite completa terminó con **572 superadas, 15 omitidas de plataforma/PG local, 0 fallos** y 2,786 aserciones en 90 archivos. Finalizaron con código 0: `bun run typecheck`, `git diff --check` y `bash -n scripts/install.sh scripts/install-from-source.sh`. Las pruebas nativas de Windows se ejecutan en los entornos automatizados de GitHub Actions en PRs y releases, no localmente en macOS.

#### Preparación para Versiones Estables:
Con la incrustación del módulo nativo en Windows, la migración al hogar propio `~/.forge614/engram/`, la verificación reforzada de carga en perfil vacío y la validación de `SHA256SUMS` completadas en CI, los requisitos de validación son:
1. **Validación del ejecutable fuera del repositorio en máquina limpia:** Probar la instalación y ejecución del binario en máquinas limpias sin dependencias de desarrollo previas.
2. **Verificación de dependencias de tiempo de ejecución:** Certificar que el binario autónomo cargue sin requerir paquetes externos redistribuibles adicionales.
3. **Publicación deliberada de la versión oficial:** Crear y enviar la etiqueta oficial (`git tag vX.Y.Z && git push origin vX.Y.Z`) para activar la publicación final en GitHub Releases tras la aprobación humana.

---

## 11. Inicialización Programática Alternativa (`init`)

Si estás configurando un entorno automatizado donde no deseas interacción humana con el asistente `setup`, puedes inicializar el espacio local básico directamente:

```bash
forge614-engram init
```

Salida en JSON:
```json
{
  "initialized": true,
  "storage": "sqlite"
}
```

Este comando:
1. Prepara el hogar de producto de Engram: si existen datos antiguos sueltos en `~/.forge614/`, los migra de forma segura y automática a `~/.forge614/engram/`.
2. Valida el contenedor compartido `~/.forge614/` sin modificarlo y después crea o repara exclusivamente `~/.forge614/engram/` con permisos estrictos `0700`.
3. Escribe `~/.forge614/engram/.env` en Formato 2 (`0600`) si no existía.
4. Inicializa `~/.forge614/engram/engram.db` en modo WAL (`0600`) con el esquema de recuerdos.
5. Es completamente **idempotente y seguro**: si la base de datos ya existía con datos previos, no borra ni altera ningún recuerdo existente.

---

## 12. Primer Proyecto y Primer Recuerdo Manual

### Crear un Proyecto
El identificador de proyecto es un identificador único e inmutable (UUID). El nombre visible es puramente descriptivo. Puedes crearlo mediante el Centro de Control TUI (`Actions > Create project`) o por CLI:

```bash
forge614-engram project-create --name "Motor de Recomendaciones"
```

Salida:
```json
{
  "projectId": "8b08708c-9bf1-4770-9fa6-3f1eb94644a4",
  "name": "Motor de Recomendaciones",
  "createdAt": "2026-09-17T11:50:00.000Z",
  "updatedAt": "2026-09-17T11:50:00.000Z"
}
```

### Guardar un Recuerdo de Proyecto (`scope: project`)
El alcance predeterminado es `project` y requiere indicar el identificador `--project-id`:

```bash
forge614-engram save \
  --project-id "8b08708c-9bf1-4770-9fa6-3f1eb94644a4" \
  --title "Elección de Algoritmo" \
  --content "Usaremos filtrado colaborativo basado en matrices dispersas." \
  --type decision \
  --topic "algoritmo-recomendacion"
```

### Guardar un Recuerdo Compartido Universal (`scope: shared`)
Para registrar una preferencia o política global que aplique a todos los proyectos de tu computadora:

```bash
forge614-engram save \
  --scope shared \
  --title "Idioma de Explicación" \
  --content "Todas las explicaciones y documentación deben redactarse en español con rigor técnico." \
  --type preference \
  --topic "idioma-documentacion"
```

> [!TIP]
> Observa que con `--scope shared`, no se especifica `--project-id` porque el recuerdo no pertenece a un proyecto individual sino al espacio universal de tu usuario.

---

## 13. Desinstalación Protegida del Sistema (`uninstall`)

Forge614 Engram incorpora un comando de desinstalación quirúrgica y coordinada que garantiza que ningún archivo quede huérfano ni se borren datos ajenos por error.

### Reglas de Confirmación Estricta

Para prevenir desinstalaciones accidentales por scripts o comandos mal escritos, `uninstall` exige la opción obligatoria `--confirm` con una frase literal en letras mayúsculas:

#### Caso A: Cuando Engram está solo en el sistema (sin Forge614 Atlas)
```bash
forge614-engram uninstall --confirm "REMOVE FORGE614-ENGRAM"
```

#### Caso B: Cuando Forge614 Atlas está instalado (`~/.forge614/atlas/` existe)
Dado que Forge614 Atlas depende directamente de los servicios de memoria compartida de Engram, el sistema detecta su presencia y exige una frase explícita de confirmación dual:
```bash
forge614-engram uninstall --confirm "REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS"
```
Si ingresas una frase distinta o la frase simple cuando Atlas existe, el comando se detiene de inmediato con el error `UNINSTALL_CONFIRMATION` sin alterar ningún archivo.

### Fases de Ejecución del Proceso de Desinstalación

1. **Coordinación previa con Forge614 Atlas:**
   Si la carpeta `~/.forge614/atlas/` existe, Engram invoca formalmente al desinstalador de Atlas:
   `~/.forge614/atlas/bin/forge614-atlas uninstall --from forge614-engram --confirmed`
   - Si el ejecutable de Atlas no está disponible, se aborta con `ATLAS_UNINSTALL_REQUIRED`.
   - Si el desinstalador de Atlas falla o devuelve un código distinto de cero, se aborta con `ATLAS_UNINSTALL_FAILED`. En ambos casos, **Engram detiene la operación de inmediato y conserva el 100% de sus datos y configuraciones intactos**.
2. **Retiro de configuraciones en asistentes:**
   Engram inspecciona todos los asistentes compatibles (Claude Code, Codex, Cursor, OpenCode, Antigravity). Retira exclusivamente las entradas de servidor MCP y los ganchos (*hooks*) administrados por Engram.
   - Si detecta archivos corruptos o bloqueos de permisos, se detiene con `ASSISTANT_REMOVE_FAILED` sin tocar los datos de memoria.
3. **Retiro quirúrgico de la variable PATH:**
   Engram examina tus archivos de inicio de terminal (`.zshrc`, `.bashrc`, `.bash_profile`, `forge614-engram.fish` o el PATH de usuario en Windows):
   - Localiza el bloque delimitado exacto (`# >>> forge614-engram PATH >>>` ... `# <<< forge614-engram PATH <<<`).
   - Si el bloque fue modificado a mano o duplicado, Engram se abstiene de tocarlo y lanza `PATH_CONFLICT` para no destruir tus personalizaciones manuales.
   - En condiciones normales, elimina limpiamente el bloque y conserva intacto todo el resto de tu archivo.
4. **Eliminación exclusiva del hogar de producto:**
   Una vez completados con éxito todos los pasos anteriores, Engram elimina **únicamente** su subcarpeta `~/.forge614/engram/`.
   - **El contenedor compartido `~/.forge614/` y carpetas hermanas como `shell/` permanecen totalmente intactos.**

### Salida JSON de Éxito:
```json
{
  "removed": true,
  "atlasRemoved": false,
  "assistantPaths": [
    "/Users/usuario/.zshrc"
  ]
}
```
