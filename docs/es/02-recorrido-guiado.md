# 02. Recorrido Guiado del Sistema

> **Etapa:** Centro de Control TUI, FTS5 Reforzado (sin embeddings), Monolito Modular por Funcionalidad, Sesiones de Memoria Progresiva, Contexto Clasificado, 10 Herramientas MCP, Memoria Local y Sincronización PostgreSQL Opcional
> **Esquemas:** SQLite Esquemas 3 (local) / 4 (sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas) / 7 (confirmaciones inmutables y orden reforzado) | Réplica PostgreSQL Formatos 1, 2 y 3 (promoción explícita con `sync --upgrade-format`; tabla física remota `state.format = 1`)
> **Estado:** Vigente y Activo (504 pruebas totales en 82 archivos: 495 superadas y 9 omitidas sin binarios aislados PG; 504 superadas, 0 fallos, 2566 aserciones con `FORGE614_TEST_POSTGRES_BIN` configurado en macOS con Bun 1.3.8 en 39.76s)
> **Traducción hermana:** [02 (EN). Guided System Walkthrough](../en/02-guided-walkthrough.md)

Este recorrido práctico te guía paso a paso por el ciclo de vida integral de Forge614 Engram: desde configurar el espacio global interactivamente con `setup`, supervisar y administrar el sistema mediante el **Centro de Control interactivo en terminal (`tui`)**, conectar tus asistentes de desarrollo mediante su subflujo seguro con autoprueba de 5 segundos, interactuar a través de las 10 herramientas del protocolo MCP nativo con resolución automática de proyectos por Git, gestionar sesiones de trabajo progresivas con líneas temporales (`timeline`), registrar recuerdos repetidos mediante confirmaciones inmutables sin fabricar versiones redundantes (Esquema 7), ensamblar contextos de prompt clasificados (`context`), realizar búsquedas FTS5 reforzadas con factores matemáticos transparentes sin embeddings, gestionar actualizaciones seguras de plugins en OpenCode y sincronizar réplicas con PostgreSQL con promoción explícita a Formato 3.

---

## 1. El Concepto de Proyecto y su Identidad (`projectId`)

En Forge614 Engram, **todos los proyectos comparten una única base de datos (`~/.forge614/engram.db`) y un único archivo de configuración (`~/.forge614/.env`)**.

Dentro de esa base, los proyectos se registran formalmente con dos elementos:
1. **`projectId` (Identificador único e inmutable):** Es un código UUIDv4 en minúsculas generado automáticamente (por ejemplo `7c9e6679-7425-40de-944b-e07fc1f90ae7`). Es la clave que vincula todos los recuerdos a ese proyecto.
2. **`name` (Nombre visual descriptivo):** Una etiqueta legible para los humanos (por ejemplo, `"Tienda Virtual"`). Cambiar el nombre con `project-rename` jamás cambia el `projectId` ni altera los recuerdos guardados.

> [!WARNING]
> **Aislamiento lógico, no control multiusuario:** El aislamiento por `projectId` organiza tus datos para que un proyecto jamás lea los recuerdos privados de otro. Sin embargo, no es un sistema de contraseñas de red ni permisos de usuario. Cualquier programa que se ejecute con tu usuario en la computadora puede acceder al almacén. **Nunca guardes contraseñas, secretos de API ni tokens privados en tus recuerdos.**

---

## 2. Los Dos Alcances de un Recuerdo (`scope`)

El campo `scope` define dónde aplica cada nota guardada:

| Alcance (`scope`) | Identificador (`projectId`) | Propósito y Uso |
| :--- | :--- | :--- |
| **`project`** | UUID de un proyecto registrado | Decisiones, hechos o reglas que aplican **únicamente a ese proyecto**. |
| **`shared`** | `null` (sin proyecto) | Preferencias o aprendizajes universales que aplican a **todos los proyectos**. |

### Ejemplos cotidianos:
- *"Esta aplicación utiliza SQLite"* $\rightarrow$ Alcance de **proyecto** (`scope: project`).
- *"Prefiero explicaciones en español"* $\rightarrow$ Alcance **compartido** (`scope: shared`).

Un recuerdo compartido se guarda **una sola vez en la base de datos**; no se clona ni se duplica en cada proyecto.

---

## 3. Recorrido Paso a Paso del Ciclo de Vida

### Paso 1: Configurar el Espacio Global (`setup` o `init`)

Para inicializar tu espacio central de trabajo de forma guiada:

```bash
forge614-engram setup
```

**Flujo interactivo en la terminal:**
1. Muestra la ubicación de los archivos centrales: `~/.forge614/.env` y `~/.forge614/engram.db`.
2. Pregunta si deseas habilitar sincronización con PostgreSQL:
   - Opción 1: `No` (predeterminada, modo exclusivamente local).
   - Opción 2: `Sí, configurar PostgreSQL` (solicita URL con entrada oculta y advertencia de réplica total).
3. Presenta el resumen de cambios y pide confirmación explícita (`Sí, aplicar cambios` o `Cancelar y salir`).
4. Al confirmar, prepara la carpeta `0700`, escribe el archivo `.env` en `0600` e inicializa `engram.db`.
5. Si cancelas con `Ctrl+C` o `q`, termina con código **130** sin tocar el disco.

---

### Paso 2: El Centro de Control Interactivo en Terminal (`tui`)

Para supervisar el estado de tu almacenamiento, proyectos, capacidades y asistentes sin memorizar comandos ni exponer secretos, abre el Centro de Control:

```bash
forge614-engram tui
```

> [!NOTE]
> `tui` requiere una terminal interactiva real (`TTY`). En entornos automatizados sin TTY falla de inmediato arrojando `INTERACTIVE_REQUIRED`.

#### 1. Principio de Solo Lectura por Defecto:
Al abrirse, el Centro de Control lee el estado local de forma completamente pasiva:
- No crea bases de datos ni archivos `.env`. Si no hay configuración, explica que uses `setup` o `init` y permanece sin escribir.
- No registra proyectos ficticios ni altera contadores.
- Puedes navegar libremente entre secciones sin temor a modificar nada.

#### 2. Barra de Menú y Secciones:
```text
Summary | Projects | Shared | Storage | Actions | Assistants | Exit
```
- **Summary (Resumen):** Muestra el estado general de inicialización, versión de esquema SQLite activo, capacidades habilitadas (Asistentes, Sesiones, Refuerzo de búsqueda), total de proyectos y estadísticas agregadas de memoria compartida.
- **Projects (Proyectos):** Lista cada proyecto registrado con su nombre legible, UUID abreviado (ej. `7c9e6679...`) y número de recuerdos activos y archivados. Al presionar **Enter** sobre un proyecto, se abre la vista de **Detalle**:
  - UUID completo (`7c9e6679-7425-40de-944b-e07fc1f90ae7`).
  - Fechas de creación y última actualización.
  - Lista de rutas locales vinculadas (`bindings`), verificadas en la máquina física actual.
- **Shared (Memoria Compartida):** Presenta el conteo de notas universales activas y archivadas junto con la última fecha de actualización, recordando con claridad que es una colección única para toda la máquina, no una base separada por proyecto.
- **Storage (Almacenamiento):** Expone la ruta del archivo SQLite local (`~/.forge614/engram.db`), el número exacto de esquema (3 a 7), las capacidades activas y si PostgreSQL está configurado (`configured` o `not-configured`).
  - **Seguridad total:** Oculta de forma absoluta la URL de PostgreSQL, contraseñas, secretos, títulos y contenido de recuerdos.

#### 3. Ejecución de Acciones con Confirmación de Dos Pasos (`Actions`):
En la pestaña `Actions` se ofrecen operaciones seguras:
- `Create project`: Solicita un nombre descriptivo y genera un UUID nuevo.
- `Rename project`: Permite seleccionar un proyecto y actualizar su etiqueta descriptiva conservando intactos su UUID y sus recuerdos.
- `Bind directory`: Asocia una ruta absoluta a un proyecto específico sin adivinar por nombre.
- `Enable assistant integration`: Aplica la migración aditiva a Esquema 5.
- `Enable sessions`: Aplica la migración aditiva a Esquema 6.
- `Enable search reinforcement`: Aplica la migración aditiva a Esquema 7.
- `Synchronize now`: Disponible únicamente si PostgreSQL está configurado. Ejecuta una ronda única de sincronización sin alterar el formato remoto ni instalar demonios.

**El protocolo estricto de confirmación:**
1. Al seleccionar una acción, la pantalla muestra una vista previa completa con los parámetros y consecuencias.
2. Si se solicitan datos (nombre de proyecto o ruta), se capturan y validan formalmente.
3. Se requiere **escribir la palabra `confirm`** (sin distinción de mayúsculas/minúsculas) y presionar Enter.
4. **Presionar Enter solo jamás ejecuta nada.**
5. Presionar Escape o Ctrl+C cancela inmediatamente y devuelve la terminal a su estado original sin alterar ningún byte del disco.

#### 4. Subflujo de Asistentes (`Assistants`):
Al seleccionar `Assistants`:
- El Centro de Control suspende su pantalla y restaura la terminal de forma limpia.
- Se abre de forma secuencial el configurador de asistentes existente (`assistantTui`).
- Puedes marcar clientes con la barra espaciadora (Claude Code, Codex, Cursor, OpenCode, Gemini CLI), ejecutar la autoprueba asíncrona de 5 segundos con la tecla `t`, revisar la vista previa de cambios y aplicar configuraciones con respaldos automáticos `0600` identificados por UUID.
- Al salir de la pantalla de asistentes, la terminal se restaura y el Centro de Control recarga automáticamente un resumen fresco y actualizado con las nuevas asociaciones.

---

### Paso 3: El Servidor MCP Nativo y sus 10 Herramientas

Al iniciar tu cliente de IA, este lanza en segundo plano el servidor MCP por canales estándar (`stdio`):

```bash
forge614-engram mcp
```

El servidor reserva `stdout` exclusivamente para tramas JSON-RPC. Ofrece **diez herramientas oficiales**:

1. **`memory_current_project` (`directory?`):** Resuelve el contexto Git del proyecto actual sin crear registros en la base.
2. **`memory_context` (`directory?`, `scope?`, `compact?`, `maxBytes?`):** Ensambla una vista clasificada y compacta de recuerdos fijados, recientes y resúmenes de sesión respetando un límite estricto de bytes serializados.
3. **`memory_search` (`query`, `directory?`, `limit?`, `scope?`):** Busca recuerdos activos mediante BM25 trigram FTS5 con explicaciones transparentes.
4. **`memory_get` (`id`, `directory?`, `scope?`, `version?`):** Obtiene una nota completa por su UUID, permitiendo consultar versiones históricas específicas.
5. **`memory_save` (`title`, `content`, `type`, `directory?`, `scope?`, `globalIntent?`, `topicKey?`, `pinned?`, `expectedVersion?`, `requestKey?`, `sessionId?`, `sessionProjectId?`):** Guarda o actualiza un recuerdo duradero, asociándolo opcional o inferidamente a una sesión de trabajo.
6. **`memory_history` (`id`, `directory?`, `scope?`):** Lista cronológicamente todas las revisiones históricas inmutables de una nota.
7. **`memory_session_start` (`sessionId`, `directory?`):** Inicia una sesión de trabajo activa en el proyecto actual.
8. **`memory_session_end` (`sessionId`, `directory?`):** Cierra formalmente una sesión de trabajo activa.
9. **`memory_session_summary` (`sessionId`, `summary`, `requestKey`, `directory?`, `expectedVersion?`):** Registra una bitácora estructurada de cierre para la sesión bajo el tema reservado `session/<sessionId>/summary`.
10. **`memory_timeline` (`sessionId`, `id`, `version`, `directory?`, `before?`, `after?`):** Despliega el contexto narrativo de recuerdos grabados antes y después de una decisión dentro de la misma sesión.

---

### Paso 4: Identidad Canónica por Git y Vinculación Manual (`project-bind`)

#### Resolución Canónica:
Engram ejecuta `git rev-parse --path-format=absolute --git-common-dir`.
- **Ramas vinculadas (*linked worktrees*):** Comparten la misma carpeta `.git` común y acceden a los mismos recuerdos del proyecto raíz.
- **Subcarpetas:** Se resuelven automáticamente a la raíz común del repositorio.
- **Carpetas sin Git:** Exigen pasar `--directory` explícito o disponer de una única raíz MCP; jamás se utiliza el directorio del binario como proyecto implícito.

#### Bloqueo Conservador y Vinculación Manual:
Si alguna ruta registrada en `project_bindings` ya no existe en disco (carpeta movida o disco desmontado), Engram bloquea preventivamente con `PROJECT_BINDING_REQUIRED` para no crear proyectos duplicados. Se asocia manualmente mediante la TUI (`Actions > Bind directory`) o por CLI con:

```bash
forge614-engram project-list
forge614-engram project-bind \
  --directory "/Users/usuario/Desktop/mi-proyecto" \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7"
```

---

### Paso 5: Ganchos Nativos de Asistentes (`memory-hook`)

Para clientes compatibles (Claude Code, Codex, Cursor, OpenCode, Gemini CLI), Engram inyecta orientación en eventos como inicio de sesión (`SessionStart`) o envío de prompt (`UserPromptSubmit`):

```bash
forge614-engram memory-hook --client codex
```

- Emite bloques JSON nativos de orientación invitando al modelo a consultar `memory_context` y `memory_current_project`.
- **No escribe recuerdos directamente.**
- **Aviso en Codex:** Los ganchos nuevos en Codex deben ser aprobados explícitamente por el usuario mediante `/hooks` dentro de Codex antes de que puedan ejecutarse.

---

### Paso 6: El Ciclo de Sesiones Progresivas

Una sesión progresiva permite agrupar las notas generadas durante una tarea y examinarlas en su orden de ocurrencia. Requiere haber ejecutado `forge614-engram sessions-enable` o haber activado las sesiones desde la TUI.

#### 1. Iniciar una Sesión (`session-start`):
El identificador de sesión debe tener entre 1 y 200 caracteres Unicode, sin controles ni espacios exteriores:

```bash
forge614-engram session-start \
  --directory "/Users/usuario/Desktop/mi-proyecto" \
  --session-id "sesion-refactor-auth-01"
```

Salida JSON:
```json
{
  "sessionId": "sesion-refactor-auth-01",
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "kind": "runtime",
  "startedAt": "2026-09-17T12:00:00.000Z",
  "endedAt": null
}
```

#### 2. Guardar Recuerdos con Inferencia de Sesión:
Cuando un asistente o usuario guarda una nota de proyecto sin especificar `--session-id`:
- **Caso 0 sesiones candidatas:** Si no hay ninguna sesión de ejecución (*runtime*) abierta en los últimos 7 días asociada a esa carpeta, Engram la asocia al cuaderno manual local del proyecto (`local_manual_sessions`), retornando `sessionSource: "manual"`.
- **Caso 1 sesión candidata:** Si hay exactamente una sesión de ejecución abierta en los últimos 7 días para esa carpeta vinculada, Engram la asocia automáticamente, retornando `sessionSource: "inferred"`.
- **Caso Múltiples sesiones candidatas:** Si existen 2 o más sesiones abiertas concurrentes, Engram detiene la operación arrojando `AMBIGUOUS_SESSION`, exigiendo especificar `--session-id`.

```bash
# Guardado explícito indicando la sesión:
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "sesion-refactor-auth-01" \
  --title "Tokens JWT Asimétricos" \
  --content "Firmaremos los tokens con clave privada Ed25519." \
  --type decision \
  --topic "firma-jwt"
```

Salida en guardado de proyecto:
```json
{
  "id": "e4a2d810-7215-46f9-bb20-56f7e4b2d351",
  "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "scope": "project",
  "topicKey": "firma-jwt",
  "type": "decision",
  "title": "Tokens JWT Asimétricos",
  "content": "Firmaremos los tokens con clave privada Ed25519.",
  "pinned": false,
  "version": 1,
  "createdAt": "2026-09-17T12:05:00.000Z",
  "updatedAt": "2026-09-17T12:05:00.000Z",
  "sessionId": "sesion-refactor-auth-01",
  "sessionSource": "explicit"
}
```

#### 3. Guardado de Recuerdos Compartidos con Sesión:
Para asociar una nota universal (`scope: shared`) a la sesión de un proyecto:
- Se debe indicar `--globalIntent` explicando por qué la regla aplica universalmente.
- Se debe indicar `--session-id` y `--session-project-id <UUID>`.
- La nota compartida se guarda con `projectId: null` y la respuesta **jamás expone el `sessionId` ni el origen privado**, preservando la privacidad del usuario.

```bash
forge614-engram save \
  --scope shared \
  --title "Expiración de Tokens" \
  --content "Los tokens de acceso deben expirar en un máximo de 15 minutos." \
  --type preference \
  --session-id "sesion-refactor-auth-01" \
  --session-project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --globalIntent "Aplica a todos los servicios de autenticación de la organización."
```

#### 4. Registrar el Resumen Estructurado de Sesión (`session-summary`):
Al finalizar los trabajos de la sesión, se genera una bitácora con seis campos estrictos (`goal` obligatorio; `instructions`, `discoveries`, `accomplishments`, `nextSteps`, `files`):

```bash
forge614-engram session-summary \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "sesion-refactor-auth-01" \
  --request-key "req-sum-01" \
  --summary-json '{
    "goal": "Migrar autenticación a claves asimétricas Ed25519",
    "instructions": "Mantener compatibilidad retroactiva durante 30 días",
    "discoveries": "El validador antiguo no admitía cabeceras JWK",
    "accomplishments": "Emisión de tokens Ed25519 operativa y probada",
    "nextSteps": "Desplegar middleware de rotación de claves",
    "files": ["src/auth/jwt.ts", "src/auth/middleware.ts"]
  }'
```

Se guarda automáticamente como procedimiento bajo el tema reservado `session/sesion-refactor-auth-01/summary` y queda enlazado en `session_summaries`.

#### 5. Cerrar la Sesión (`session-end`):
```bash
forge614-engram session-end \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "sesion-refactor-auth-01"
```

---

### Paso 7: Refuerzo de Búsqueda FTS5 y Confirmaciones Inmutables (Esquema 7)

El Esquema 7 añade a Forge614 Engram la capacidad de registrar repeticiones como **confirmaciones inmutables** y ponderar el orden de búsqueda FTS5 sin utilizar embeddings ni modelos secundarios de IA.

#### 1. Habilitación Local (`reinforcement-enable`):
Puede habilitarse desde la pestaña `Actions` del Centro de Control TUI o mediante terminal:
```bash
forge614-engram reinforcement-enable
```
Salida: `{"enabled": true, "schema": 7}`.

#### 2. Guardar un Recuerdo Inicial con Clave de Petición (`--request-key`):
Para garantizar que una operación sea idempotente y segura ante reintentos de red o de proceso, el asistente asigna una `requestKey`:

```bash
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --title "Cola de Tareas en Segundo Plano" \
  --content "Usaremos colas basadas en SQLite WAL para tareas asíncronas." \
  --type decision \
  --request-key "req-queue-01"
```

El recuerdo se crea en versión 1, con 0 revisiones previas y 0 confirmaciones.

#### 3. Reintento Idempotente con la Misma Clave (`Replay`):
Si la conexión o el asistente se interrumpen y se vuelve a ejecutar la **misma petición con la misma clave `req-queue-01`**:
- El sistema detecta la clave existente en `requests`.
- Devuelve inmediatamente la respuesta almacenada previamente.
- **No añade confirmaciones ni incrementa versiones.**

#### 4. Conflicto de Carga en Reintento (`REQUEST_CONFLICT`):
Si se reutiliza la misma clave `req-queue-01` enviando un contenido o título diferente:
- El sistema detecta la discrepancia en el hash criptográfico SHA-256 de la carga.
- Aborta inmediatamente arrojando el error `REQUEST_CONFLICT`.

#### 5. Guardado Repetido con Nueva Clave: Registro de Confirmación:
Si en un momento posterior (dentro de una ventana móvil de **15 minutos** para notas sin tema) el asistente vuelve a observar y guardar exactamente el mismo dato activo (mismo título, contenido, tipo y estado de fijado) utilizando una **nueva clave** `req-queue-02`:

```bash
forge614-engram save \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --title "Cola de Tareas en Segundo Plano" \
  --content "Usaremos colas basadas en SQLite WAL para tareas asíncronas." \
  --type decision \
  --request-key "req-queue-02"
```

**Comportamiento de Engram:**
- **No crea una versión 2 redundante.**
- Registra un evento inmutable en la tabla `confirmations` con su propio `confirmationId` (UUID), versión referenciada, fecha UTC y sesión actual.
- Devuelve la versión 1 intacta con la sesión actualizada.
- Al consultar el historial (`forge614-engram history --id <id>`), se comprueba que existe **exactamente 1 versión**, manteniendo el registro limpio de versiones artificiales.
- **Significado honesto:** Esto indica que el dato fue observado nuevamente; **no certifica que sea una verdad absoluta ni que un humano lo haya verificado**.

#### 6. Ventana Móvil de 15 Minutos (Deduplicación sin Tema):
Para recuerdos generales sin tema (`topicKey: null`), la deduplicación solo considera candidatos activos observados en los últimos 15 minutos (entre `ahora - 900,000 ms` y `ahora`). Si pasan más de 15 minutos, Engram crea un recuerdo independiente nuevo para no fusionar hechos distantes en el tiempo. Si existen múltiples candidatos dentro de la ventana, selecciona el más recientemente observado y desempata por `id ASC`.

---

### Paso 8: Recuperación Progresiva y Búsqueda Reforzada (Previews, Timeline, Context)

Engram implementa un modelo de recuperación progresiva:

#### 1. Búsqueda FTS5 con Factores de Refuerzo (`--preview`):
La búsqueda textual en SQLite FTS5 evalúa las coincidencias BM25 y aplica la fórmula de ranking con multiplicador de actualidad y estabilidad:

```bash
forge614-engram search \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --query "colas sqlite" \
  --preview
```

Salida representativa con explicación detallada de factores:
```json
[
  {
    "memory": {
      "id": "e4a2d810-7215-46f9-bb20-56f7e4b2d351",
      "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "scope": "project",
      "topicKey": null,
      "type": "decision",
      "title": "Cola de Tareas en Segundo Plano",
      "preview": "Usaremos colas basadas en SQLite WAL para tareas asíncronas.",
      "truncated": false,
      "pinned": false,
      "version": 1,
      "createdAt": "2026-09-17T12:05:00.000Z",
      "updatedAt": "2026-09-17T12:05:00.000Z"
    },
    "explanation": {
      "mode": "fts5",
      "bm25": -2.145,
      "multiplier": 1.069,
      "orderScore": -2.293,
      "reinforcement": {
        "revisionCount": 0,
        "duplicateCount": 1,
        "lastSeenAt": "2026-09-17T12:12:00.000Z",
        "ageDays": 0.005,
        "pinnedBoost": 0,
        "recencyBoost": 0.059,
        "stabilityBoost": 0.008
      }
    }
  }
]
```

> [!NOTE]
> Observa que el ordenamiento de SQLite FTS5 es ascendente por `orderScore = bm25 * multiplier`. Al ser BM25 negativo, un multiplicador mayor (por notas fijadas, recientes o con más confirmaciones) produce un número más negativo, posicionando la nota antes en los resultados.

#### 2. Lectura de Versión Específica (`get --version`):
Si necesitas el contenido íntegro de una revisión histórica:

```bash
forge614-engram get \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --id "e4a2d810-7215-46f9-bb20-56f7e4b2d351" \
  --version 1
```

Devuelve `{ "memory": MemoryVersion, "currentVersion": 2, "state": "active" }`. La versión histórica consultada jamás se etiqueta erróneamente como versión actual.

#### 3. Línea Temporal de Sesión (`timeline`):
Permite auditar el hilo de pensamiento recuperando notas previas y posteriores dentro de una misma sesión:

```bash
forge614-engram timeline \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --session-id "sesion-refactor-auth-01" \
  --id "e4a2d810-7215-46f9-bb20-56f7e4b2d351" \
  --version 1 \
  --before 3 \
  --after 3
```

Devuelve `{ "sessionId", "focus", "before", "after" }`, donde `focus` muestra hasta 500 puntos de código Unicode y las notas vecinas muestran hasta 150 puntos de código Unicode.

#### 4. Contexto Ensamblado de Prompt (`context`):
Reúne automáticamente el estado cognitivo del proyecto al arrancar una tarea o tras compactar contexto:
- Hasta 20 recuerdos prioritarios fijados (`pinned`).
- Hasta 20 recuerdos recientes no fijados (`recent`).
- Hasta 5 resúmenes de sesiones anteriores (`summaries`).
- Limita el resultado a un presupuesto estricto de **bytes de JSON serializado** (`--max-bytes`, por defecto 16384; rango 1024..65536) y permite omitir previews con `--compact`:

```bash
forge614-engram context \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --compact \
  --max-bytes 8192
```

---

### Paso 9: Actualización Segura de Plugins en OpenCode

En OpenCode, Engram genera el plugin de integración en `plugins/forge614-engram.js` utilizando callbacks experimentales upstream.

> [!IMPORTANT]
> **Gestión de Conflictos de Plugins:**
> Si ya existe un plugin de Engram en una carpeta activa de OpenCode cuyo contenido difiere del generado por la versión actual, el sistema lo trata como un conflicto de configuración (`CONFLICT`) y **nunca lo sobrescribe automáticamente**.
>
> **Procedimiento de Reconciliación:**
> 1. Abre `forge614-engram tui` e ingresa a `Assistants` para inspeccionar la vista previa.
> 2. Si reporta conflicto, haz una copia de respaldo manual de tu archivo `plugins/forge614-engram.js` existente.
> 3. Retira o reconcilia los cambios locales del archivo.
> 4. Vuelve a ejecutar `Assistants` en el Centro de Control, confirma los cambios y verifica la aplicación limpia.

---

### Paso 10: Sincronización PostgreSQL y Promoción a Formato 3 (`sync --upgrade-format`)

Si configuraste una réplica PostgreSQL en `setup`:

#### Sincronización Ordinaria:
Puede ejecutarse desde la pestaña `Actions > Synchronize now` en `forge614-engram tui` o directamente en la línea de comandos:
```bash
forge614-engram sync
```

#### Promoción Explícita a Formato 3:
Cuando tu base local cuenta con Esquema 7 (refuerzo de búsqueda con confirmaciones) y deseas que la réplica de PostgreSQL sincronice eventos de confirmación y peticiones:
- La sincronización ordinaria sin banderas (o desde la TUI) rechaza la promoción si la réplica remota está en un formato anterior, devolviendo `SYNC_UPGRADE_REQUIRED`.
- Para promover conscientemente la réplica a **Formato 3**, ejecuta:
```bash
forge614-engram sync --upgrade-format
```
- La promoción es validada atómicamente mediante bloqueo optimista CAS (*Compare-And-Swap*) sobre el hash del snapshot remoto.
- **Requisito en todos los equipos:** Antes de promover a Formato 3, **todos los equipos pares deben haberse actualizado** y haber ejecutado `reinforcement-enable`. Si un cliente que no tiene habilitado el refuerzo intenta sincronizar un paquete en Formato 3, se detiene arrojando `REINFORCEMENT_REQUIRED` para proteger los datos locales de confirmaciones no reconocidas.
- **`sync-watch` rechaza promociones:** `sync-watch --upgrade-format` no está permitido; la promoción requiere ejecutarse mediante el comando puntual `sync`.
