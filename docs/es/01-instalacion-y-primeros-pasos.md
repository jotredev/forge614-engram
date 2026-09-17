# 01. Instalación, Configuración y Primeros Pasos

> **Etapa:** Sesiones de Memoria Progresiva, Contexto Clasificado, 10 Herramientas MCP, Memoria Local y Sincronización PostgreSQL Opcional
> **Esquemas:** SQLite Esquemas 3 (local) / 4 (sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas y resúmenes estructurados) | Réplica PostgreSQL Formato 1 / Formato 2
> **Habilitaciones:** Explícitas y aditivas (`integration-enable` para Esquema 5; `sessions-enable` para Esquema 6; `sync --upgrade-format` para réplica Formato 2). La apertura de base y los comandos ordinarios nunca migran automáticamente.
> **Estado:** Vigente y Verificado (250 pruebas totales en 18 archivos: 243 superadas y 7 omitidas sin binarios PG; 250 superadas, 0 fallos, 1506 aserciones con `FORGE614_TEST_POSTGRES_BIN` configurado en macOS con Bun 1.3.8)
> **Traducción hermana:** [01 (EN). Installation, Setup, and Getting Started](../en/01-installation-and-getting-started.md)

Esta guía explica paso a paso cómo preparar las dependencias, compilar e instalar el comando `forge614-engram` en tu computadora, los requisitos indispensables (incluyendo Git obligatorio), cómo funciona la detección post-instalación de asistentes, el asistente interactivo `setup` para el espacio central, y la habilitación explícita de la integración de asistentes (Esquema 5) y del ciclo de sesiones progresivas (Esquema 6) junto con la coordinación entre equipos pares.

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
8. **Detección post-instalación de asistentes:** Tras publicar el ejecutable, ejecuta una inspección de solo lectura (`assistant-list`) que analiza qué asistentes de desarrollo (Claude Code, Codex, Cursor, OpenCode, Gemini CLI) están instalados en tu sistema.
9. **Ofrecimiento interactivo del menú TUI:** Si la instalación se ejecuta en una terminal interactiva (donde la entrada y salida son una consola real), el instalador te pregunta:
   ```text
   ¿Abrir ahora el menú de asistentes? [s/N]
   ```
   Si respondes afirmativamente (`s` o `si`), abre de inmediato la interfaz interactiva `tui`. Si se ejecuta sin terminal interactiva (por ejemplo en un script automatizado), el instalador no pregunta ni espera, no modifica configuraciones, no inicializa la base de datos e imprime el comando `forge614-engram tui` para ejecutarlo posteriormente.
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
tui             Asistentes: flechas, Espacio, vista previa y confirmación explícita.
init            Inicializa una sola configuración y base local, sin borrar datos.
sync [--upgrade-format]
                Sincroniza todo; --upgrade-format promueve explícitamente una réplica formato 1.
sync-watch      Reintenta mientras esté abierto [--interval <1..3600 segundos>, defecto 30].
integration-enable  Habilita explícitamente MCP y asociaciones locales (esquema 5).
sessions-enable Habilita explícitamente sesiones (esquema 6).
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
sync-watch debe permanecer abierto para reintentar; no se instala un servicio permanente.
setup puede añadir metadatos de sincronización al esquema 3 sin borrar recuerdos.
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
> 1. No
  2. Sí, configurar PostgreSQL

Opción [1]:
```

### Opciones de Sincronización
- **Opción 1: `No` (Predeterminada):**
  Presionar Enter selecciona `No`. El sistema opera de manera 100% local e independiente. Se genera un archivo de configuración en **Formato 2** sin variables de PostgreSQL.
- **Opción 2: `Sí, configurar PostgreSQL`:**
  Si eliges `2`, el asistente solicita la URL de conexión de forma confidencial con **entrada oculta en pantalla** (`{ secret: true }`). La contraseña que escribas no se mostrará ni en texto claro ni con asteriscos, protegiendo tus credenciales de miradas indiscretas.

### Resumen y Confirmación Previa
Antes de escribir un solo byte en el disco, el asistente muestra un resumen claro del plan y pide confirmación explícita:

```text
¿Deseas guardar esta configuración e inicializar la base de datos?
> 1. Sí, aplicar cambios
  2. Cancelar y salir
```

> [!NOTE]
> Si eliges `Cancelar y salir` o presionas `Ctrl+C` en cualquier punto:
> - El comando termina con código de salida **130**.
> - **No se escribe ningún archivo.** Si la carpeta `~/.forge614/` no existía, permanecerá inexistente.
> - Si ya existía una base de datos con recuerdos previos, estos se preservan intactos sin alteraciones.

---

## 6. Habilitar la Integración de Asistentes (Esquema 5)

Para que los asistentes de inteligencia artificial puedan interactuar con la memoria y registrar asociaciones locales de carpetas a proyectos (`project_bindings`), la base de datos debe encontrarse en **Esquema 5**.

Existen dos vías para habilitar el Esquema 5:

### Vía A: Menú Interactivo de Asistentes (`tui`)
Ejecutando `forge614-engram tui`, al seleccionar y confirmar los asistentes deseados, el menú valida los planes de configuración, inicializa el espacio global y ejecuta internamente la migración aditiva a Esquema 5 antes de aplicar los archivos de los clientes.

### Vía B: Comando Explícito (`integration-enable`)
Si deseas preparar el espacio y habilitar el Esquema 5 sin alterar archivos de configuración de ningún cliente:

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

## 7. Habilitar el Ciclo de Sesiones Progresivas (Esquema 6)

Para que los asistentes y la terminal puedan crear sesiones de trabajo (`session-start`), consultar líneas temporales (`timeline`), ensamblar contextos clasificados (`context`) y registrar resúmenes estructurados (`session-summary`), la base de datos debe encontrarse en **Esquema 6**.

### Comando Explícito (`sessions-enable`)
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

### Reglas Críticas de Habilitación y Migración:
1. **Nunca hay migración automática:**
   El comando del servidor MCP (`forge614-engram mcp`), la apertura normal de la base de datos (`workspace.open()`), la inicialización (`init`), el listado de proyectos o las búsquedas y lecturas ordinarias **jamás migran automáticamente la base de datos local**. Si intentas usar comandos de sesión en una base sin Esquema 6, el sistema se detiene arrojando el error `MIGRATION_REQUIRED`.
2. **Tablas incorporadas por el Esquema 6:**
   Crea aditivamente las tablas relacionales:
   - `sessions`: Registro inmutable de sesiones de ejecución (*runtime*) y manuales.
   - `session_entries`: Tira cronológica que asocia versiones de recuerdos a sesiones.
   - `session_summaries`: Punteros a los resúmenes estructurados de cada sesión.
   - `local_session_bindings`: Asociaciones locales entre sesiones y carpetas en disco.
   - `local_manual_sessions`: Cuadernos de sesión manual exclusiva por proyecto para este equipo.
3. **Coordinación entre Equipos Pares (*Peer Devices*):**
   Si sincronizas tu memoria con otras computadoras mediante PostgreSQL:
   - Las otras computadoras **deben instalar una versión compatible** de Forge614 Engram.
   - En cada equipo par debe ejecutarse explícitamente `forge614-engram sessions-enable` para preparar su SQLite local antes de sincronizar datos con sesiones.
4. **Promoción de Réplica PostgreSQL (Formato 1 a Formato 2):**
   Si la réplica de PostgreSQL fue creada previamente en Formato 1 (solo proyectos y recuerdos), **no se promueve de forma automática**. Para promoverla explícitamente a Formato 2 (con sesiones) se debe ejecutar conscientemente:
   ```bash
   forge614-engram sync --upgrade-format
   ```
   *(Nota: `sync-watch --upgrade-format` es rechazado; la promoción requiere confirmación en una sola ronda y está protegida por validación optimista CAS).*

---

## 8. Inspección de Asistentes en JSON (`assistant-list`)

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
  }
]
```

---

## 9. Inicialización Programática Alternativa (`init`)

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

## 10. Primer Proyecto y Primer Recuerdo Manual

### Crear un Proyecto
El identificador de proyecto es un identificador único e inmutable (UUID). El nombre visible es puramente descriptivo:

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
