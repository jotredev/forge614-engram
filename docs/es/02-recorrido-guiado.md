# 02. Recorrido Guiado del Sistema

> **Etapa:** Sesiones de Memoria Progresiva, Contexto Clasificado, 10 Herramientas MCP, Memoria Local y Sincronización PostgreSQL Opcional
> **Esquemas:** SQLite Esquemas 3 (local) / 4 (sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas y resúmenes estructurados) | Réplica PostgreSQL Formato 1 / Formato 2
> **Estado:** Vigente y Activo (Verificado con 250 pruebas en macOS con Bun 1.3.8)
> **Traducción hermana:** [02 (EN). Guided System Walkthrough](../en/02-guided-walkthrough.md)

Este recorrido práctico te guía paso a paso por el ciclo de vida integral de Forge614 Engram: desde configurar el espacio global interactivamente con `setup`, conectar tus asistentes de desarrollo mediante el menú interactivo en terminal `tui`, interactuar a través de las 10 herramientas del protocolo MCP nativo con resolución automática de proyectos por Git, gestionar sesiones de trabajo progresivas con líneas temporales (`timeline`), ensamblar contextos de prompt clasificados (`context`), hasta realizar búsquedas explicables con vista previa, gestionar actualizaciones seguras de plugins en OpenCode y sincronizar réplicas con PostgreSQL con promoción explícita de formato.

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

### Paso 2: Menú Interactivo de Asistentes (`tui`)

Para conectar tus clientes de desarrollo (Claude Code, Codex, Cursor, OpenCode y Gemini CLI) sin editar manualmente archivos JSON o TOML, abre el menú interactivo en terminal:

```bash
forge614-engram tui
```

> [!NOTE]
> `tui` requiere una terminal interactiva real (`TTY` con soporte de modo crudo / *raw mode*). Si se invoca sin terminal interactiva, falla inmediatamente arrojando `INTERACTIVE_REQUIRED`. Para auditorías desatendidas en scripts, utiliza `assistant-list`.

#### Controles del Menú TUI:
- **Flechas Arriba / Abajo (`↑` / `↓`):** Desplazan el cursor.
- **Barra Espaciadora (`Espacio`):** Marca o desmarca clientes para configuración.
- **Tecla `r`:** Vuelve a escanear ejecutables y configuraciones en el sistema.
- **Tecla `c`:** Introduce rutas personalizadas para ejecutable o carpeta de configuración mediante entradas enmascaradas.
- **Tecla `t`:** Inicia la autoprueba asíncrona de 5 segundos del servidor MCP oficial sobre el binario compilado instalado. Presionar `Escape` durante la prueba cancela únicamente el test.
- **Tecla `Enter`:** Avanza entre pantallas (`Lista` $\rightarrow$ `Vista Previa` $\rightarrow$ `Confirmación` $\rightarrow$ `Aplicar`).
- **Tecla `Escape`:** Retrocede a la pantalla previa.
- **`Ctrl+C`:** Cancela la sesión inmediatamente, restaura la terminal y devuelve código **130**.

#### Seguridad en la Aplicación de Configuraciones:
1. **Previsualización sin escritura:** Previsualizar cambios jamás escribe archivos.
2. **Preflight estricto:** Descarta enlaces simbólicos (*symlinks*) y valida permisos antes de tocar disco.
3. **Respaldos privados `0600` con UUID:** Antes de modificar un archivo existente, genera una copia de seguridad exacta (ej. `settings.json.019183ab-....bak`).
4. **Preservación de comentarios:** Emplea analizadores tolerantes (JSONC y TOML) que conservan comentarios y ajustes de otras herramientas.
5. **Verificación posterior (*Post-Publication Verification*):** Si otro proceso altera el archivo en el mismo milisegundo, reporta `PUBLISHED_UNVERIFIED`, conserva los respaldos y no hace marcha atrás destructiva.

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
Si alguna ruta registrada en `project_bindings` ya no existe en disco (carpeta movida o disco desmontado), Engram bloquea preventivamente con `PROJECT_BINDING_REQUIRED` para no crear proyectos duplicados. Se asocia manualmente con:

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

Una sesión progresiva permite agrupar las notas generadas durante una tarea y examinarlas en su orden de ocurrencia. Requiere haber ejecutado `forge614-engram sessions-enable`.

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

### Paso 7: Recuperación Progresiva (Previews, Timeline, Context)

Engram implementa un modelo de recuperación progresiva (inspirado en **Gentleman** con adaptaciones de **Forge614**):

#### 1. Búsqueda con Vista Previa Acotada (`--preview`):
Para explorar sin saturar la memoria del modelo de IA, `--preview` acota el contenido a un máximo de 300 puntos de código Unicode:

```bash
forge614-engram search \
  --project-id "7c9e6679-7425-40de-944b-e07fc1f90ae7" \
  --query "jwt" \
  --preview
```

Salida representativa:
```json
[
  {
    "memory": {
      "id": "e4a2d810-7215-46f9-bb20-56f7e4b2d351",
      "projectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "scope": "project",
      "topicKey": "firma-jwt",
      "type": "decision",
      "title": "Tokens JWT Asimétricos",
      "preview": "Firmaremos los tokens con clave privada Ed25519.",
      "truncated": false,
      "pinned": false,
      "version": 1,
      "createdAt": "2026-09-17T12:05:00.000Z",
      "updatedAt": "2026-09-17T12:05:00.000Z"
    },
    "explanation": {
      "mode": "fts5",
      "bm25": -1.8542,
      "multiplier": 1.06,
      "orderScore": -1.9654
    }
  }
]
```

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

Salida JSON:
```json
{
  "format": 1,
  "pinned": [...],
  "recent": [...],
  "summaries": [...],
  "omitted": { "pinned": 0, "recent": 2, "summaries": 1 },
  "truncated": true
}
```

---

### Paso 8: Actualización Segura de Plugins en OpenCode

En OpenCode, Engram genera el plugin de integración en `plugins/forge614-engram.js` utilizando callbacks experimentales upstream.

> [!IMPORTANT]
> **Gestión de Conflictos de Plugins:**
> Si ya existe un plugin de Engram en una carpeta activa de OpenCode cuyo contenido difiere del generado por la versión actual, el sistema lo trata como un conflicto de configuración (`CONFLICT`) y **nunca lo sobrescribe automáticamente**.
>
> **Procedimiento de Reconciliación:**
> 1. Abre `forge614-engram tui` e inspecciona la vista previa.
> 2. Si reporta conflicto, haz una copia de respaldo manual de tu archivo `plugins/forge614-engram.js` existente.
> 3. Retira o reconcilia los cambios locales del archivo.
> 4. Vuelve a ejecutar `forge614-engram tui`, confirma los cambios y verifica la aplicación limpia.

---

### Paso 9: Sincronización PostgreSQL y Promoción Explícita (`sync --upgrade-format`)

Si configuraste una réplica PostgreSQL en `setup`:

#### Sincronización Ordinaria:
```bash
forge614-engram sync
```

#### Promoción Explícita de Formato 1 a Formato 2:
Si la réplica remota contiene una instantánea en Formato 1 (anterior a sesiones) y tu base local tiene Esquema 6:
- La sincronización ordinaria preserva el formato remoto para no romper compatibilidad sin consentimiento.
- Para promover conscientemente la réplica a **Formato 2** (incluyendo sesiones, entradas y resúmenes), ejecuta:
```bash
forge614-engram sync --upgrade-format
```
- La promoción es validada atómicamente mediante bloqueo optimista CAS (*Compare-And-Swap*).
- Si otra máquina intentó una promoción concurrente o modificó el estado remoto, solo una resulta ganadora; la perdedora detiene la operación sin aplicar cambios destructivos.
