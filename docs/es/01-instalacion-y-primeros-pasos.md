# 01. Instalación, Configuración y Primeros Pasos

> **Etapa:** Centro de Control TUI, FTS5 Reforzado (sin embeddings), Monolito Modular por Funcionalidad, Sesiones de Memoria Progresiva, Contexto Clasificado, 10 Herramientas MCP, Memoria Local y Sincronización PostgreSQL Opcional
> **Esquemas:** SQLite Esquemas 3 (local) / 4 (sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas) / 7 (confirmaciones inmutables y orden reforzado) | Réplica PostgreSQL Formatos 1, 2 y 3 (promoción explícita con `sync --upgrade-format`; tabla física remota `state.format = 1`)
> **Habilitaciones:** Explícitas y aditivas (`integration-enable` para Esquema 5; `sessions-enable` para Esquema 6; `reinforcement-enable` para Esquema 7; `sync --upgrade-format` para réplica Formato 2 o Formato 3). La apertura de base, el centro de control TUI y los comandos ordinarios nunca migran automáticamente.
> **Estado:** Vigente y Verificado (504 pruebas totales en 82 archivos: 495 superadas y 9 omitidas sin binarios aislados PG; 504 superadas, 0 fallos, 2566 aserciones con `FORGE614_TEST_POSTGRES_BIN` configurado en macOS con Bun 1.3.8 en 39.76s)
> **Traducción hermana:** [01 (EN). Installation, Setup, and Getting Started](../en/01-installation-and-getting-started.md)

Esta guía explica paso a paso cómo preparar las dependencias, compilar e instalar el comando `forge614-engram` en tu computadora, los requisitos indispensables (incluyendo Git obligatorio), cómo funciona la detección post-instalación de asistentes, el asistente interactivo `setup` con la oferta de refuerzo de búsqueda, el **Centro de Control interactivo en terminal (`tui`)**, la habilitación explícita de integración de asistentes (Esquema 5), sesiones progresivas (Esquema 6) y confirmaciones inmutables de FTS5 (Esquema 7), junto con la coordinación entre equipos pares.

---

## 1. ¿Qué es este programa y cómo se distribuye?

Forge614 Engram es un sistema de memoria personal y local para modelos de inteligencia artificial y desarrolladores, construido en **TypeScript**. A diferencia de los paquetes públicos de internet:
- **No se descarga desde npm:** `npm install forge614-engram` no existe porque se trata de un paquete privado de desarrollo.
- **Se compila localmente:** Se empaqueta directamente desde el código fuente del repositorio usando el script de instalación (`scripts/install.sh`).
- **Produce un ejecutable binario autónomo:** El resultado es un archivo binario independiente llamado `forge614-engram`. Una vez instalado, **no requiere tener Bun ni Node.js en el PATH** para su ejecución habitual.

### Requisitos del Sistema

1. **Bun (versión estable >= 1.3.8):**
   Requisito exclusivo para **compilar e instalar** el programa desde el código fuente o ejecutar la suite de pruebas automatizadas.
   ```bash
   bun --version
   ```
   Si no lo tienes instalado, descárgalo desde [bun.sh](https://bun.sh).

2. **Git (Disponible en PATH — Obligatorio):**
   **Git es un requisito indispensable del sistema**, no solo para clonar el repositorio, sino porque el motor de resolución de identidades de proyectos de Engram utiliza Git internamente (`git rev-parse --path-format=absolute --git-common-dir`) para identificar el directorio raíz común de proyectos, ramas vinculadas (*worktrees*) y subcarpetas. Además, Git es obligatorio para certificar de forma segura que una carpeta común **no** pertenece a Git. Si Git no está instalado o no se encuentra en el PATH, la resolución de proyectos falla cerrada arrojando el error `PROJECT_IDENTITY_UNAVAILABLE`.
   ```bash
   git --version
   ```

3. **Sistema Operativo:**
   macOS o Linux con shell compatible con Bash (`bash`).

4. **Servidor PostgreSQL (Opcional):**
   Únicamente si decides habilitar la sincronización de réplica. Se requiere PostgreSQL 14 o superior. El usuario debe contar con privilegios para crear y escribir en el esquema `forge614_sync`. Debe emplearse una base de datos vacía y dedicada o una ya compatible con Forge614.

---

## 2. Preparación de Dependencias e Instalación

### Paso 2.1 — Preparar dependencias locales en un clon nuevo

El script de instalación **no descarga dependencias de la red automáticamente** ni altera tu archivo de bloqueo (`bun.lock`). En un clon nuevo del repositorio, antes de compilar debes preparar las dependencias congeladas:

```bash
cd /Users/jorgeetrejoo/Desktop/forge614-engram
bun install --frozen-lockfile --ignore-scripts
```

> [!IMPORTANT]
> Si faltan dependencias locales en `node_modules/` o las versiones instaladas no coinciden exactamente con las declaradas en `package.json`, el instalador mostrará un mensaje de error claro y fallará antes de compilar o publicar cualquier archivo, protegiendo la integridad del entorno.

### Paso 2.2 — Ejecutar el instalador autónomo

Desde la carpeta raíz del repositorio:

```bash
bash scripts/install.sh
```

#### ¿Qué realiza exactamente el instalador?
1. Verifica que Bun esté disponible y sea versión >= 1.3.8.
2. Verifica que Git esté disponible en el PATH del sistema.
3. Comprueba las dependencias locales contra `package.json` sin descargas de red ni modificaciones silenciosas a `bun.lock`.
4. Compila `src/cli.ts` en un ejecutable nativo autónomo mediante `bun build ./src/cli.ts --compile`.
5. Publica atómicamente el binario en `$HOME/.local/bin/forge614-engram` con permisos `0755` mediante enlace duro (*hard-link*).
6. **Protección contra sobreescritura accidental:** Si el archivo ya existe, se detiene para evitar sobrescribir ejecutables sin autorización. Para actualizar la instalación, utiliza la bandera `--force`:
   ```bash
   bash scripts/install.sh --force
   ```
   *(Nota: `--force` reemplaza únicamente el binario; jamás altera tu configuración `.env` ni tus recuerdos en `engram.db`).*
7. **Directorio personalizado:** Si deseas instalar en otra ruta de ejecutables:
   ```bash
   bash scripts/install.sh --bin-dir /ruta/a/bin
   ```
8. **Detección post-instalación de asistentes:** Tras publicar el ejecutable, ejecuta una inspección de solo lectura (`assistant-list`) que analiza qué asistentes de desarrollo (Claude Code, Codex, Cursor, OpenCode, Antigravity) están instalados en tu sistema.
9. **Ofrecimiento interactivo del Centro de Control TUI:** Si la instalación se ejecuta en una terminal interactiva (donde la entrada y salida son una consola real TTY), el instalador te pregunta:
   ```text
   ¿Abrir ahora el menú de asistentes? [s/N]
   ```
   Si respondes afirmativamente (`s` o `si`), abre de inmediato el Centro de Control interactivo `tui`. Si se ejecuta sin terminal interactiva (por ejemplo en un script automatizado), el instalador no pregunta ni espera, no modifica configuraciones, no inicializa la base de datos e imprime el comando `forge614-engram tui` para ejecutarlo posteriormente.
10. **Sin selección de proyectos:** El instalador **jamás pide elegir ni configurar proyectos**.

---

## 3. Configurar tu Terminal (La Variable PATH)

Para escribir `forge614-engram` directamente desde cualquier carpeta sin tener que escribir la ruta completa (`$HOME/.local/bin/forge614-engram`), añade la carpeta a tu PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

> [!TIP]
> Para que este cambio sea permanente al abrir nuevas terminales, agrégalo a tu archivo de inicio (`~/.zshrc` en macOS o `~/.bashrc` en Linux).

---

## 4. Comprobar la Instalación

Comprueba la versión instalada y la ayuda general sin tocar el disco ni crear archivos:

```bash
# Comprobar la versión instalada
forge614-engram --version
# Salida esperada: forge614-engram 0.5.0

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
  Configuración : /Users/usuario/.forge614/.env
  Base de datos : /Users/usuario/.forge614/engram.db

¿Quieres habilitar la sincronización con una base de datos PostgreSQL?
No
Sí, configurar PostgreSQL
Elige [si/NO]:
```

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

> [!NOTE]
> Si eliges `no` o presionas `Ctrl+C` en cualquier punto:
> - El comando termina con código de salida **130** (*Cancelled*).
> - **No se escribe ningún archivo.** Si la carpeta `~/.forge614/` no existía, permanecerá inexistente.
> - Si ya existía una base de datos con recuerdos previos, estos se preservan intactos sin alteraciones.

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
   - Todas las computadoras deben actualizarse a la versión 0.5.0 compatible.
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

#### Seguridad de Rutas en Windows:
* En sistemas POSIX (macOS y Linux), Engram valida la seguridad de los archivos verificando permisos octales privados (`0700` para carpetas y `0600` para archivos).
* En Windows, los permisos POSIX no reflejan con precisión las listas de control de acceso (*Access Control Lists* / ACL) del sistema NTFS.
* Por ello, Engram implementa una validación específica para Windows que **rechaza enlaces simbólicos (*symbolic links*), uniones de directorios (*junctions*) y puntos de reanálisis (*reparse points*)** antes de escribir cualquier archivo de configuración.
* Esta protección impide que una ruta en apariencia inocente redirija la escritura de configuraciones hacia directorios no autorizados o comprometidos.
* **Estado de verificación en Windows:** La validación nativa de Windows para publicación y puntos de reanálisis está configurada en la integración continua (CI) y **permanece como validación pendiente de CI hasta que el job nativo en GitHub Actions confirme su resultado**.

#### Garantías de Calidad y Pruebas Documentadas:
La integración con Antigravity y la seguridad multiplataforma están respaldadas por pruebas automatizadas:
* Se comprobó que Antigravity escribe únicamente en `~/.gemini/config/mcp_config.json`.
* Se comprobó que `~/.gemini/settings.json` permanece inalterado byte por byte.
* Se comprobó que Antigravity no instala ni registra hooks.
* Se comprobó que los comentarios y entradas JSON ajenas sobreviven intactos a la inserción.
* Se comprobó que configuraciones inválidas, duplicadas, conflictivas, modificadas tras la vista previa o situadas tras enlaces inseguros son rechazadas.
* Se restauró la prueba de fallo parcial: si un asistente aplica su configuración y el siguiente falla, Engram informa con transparencia el resultado real y conserva los respaldos privados sin simular un éxito total ficticio.
* La ejecución nativa de Windows para publicación y reparse points permanece pendiente de validación en CI.

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
1. Crea la carpeta `~/.forge614/` con permisos estrictos `0700` si no existía.
2. Escribe `~/.forge614/.env` en Formato 2 (`0600`) si no existía.
3. Inicializa `~/.forge614/engram.db` en modo WAL (`0600`) con el esquema de recuerdos.
4. Es completamente **idempotente y seguro**: si la base de datos ya existía con datos previos, no borra ni altera ningún recuerdo existente.

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
