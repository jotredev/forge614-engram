# Handoff técnico 21: Retiro de `setup`, comando unificado `init [--json]`, aplicación atómica de inicialización y clarificación del rol de Shell

Fecha de verificación: 2026-09-19 (UTC).
Rama: `feat/engram-nonvisual-initialization` (basada en `main` tag `v1.1.0-beta.2`).
Versión base: 1.1.0-beta.2.
Commits clave de la entrega:
- `df26d8a`: `docs: clarify optional Shell runtime`
- `893b57f`: `feat: apply approved memory initialization requests`
- `1cbeb75`: `feat: replace setup command with init`

Documento previo: [`docs/handoffs/20-engram-nonvisual-initialization-contract.md`](20-engram-nonvisual-initialization-contract.md)
Contrato rector de ecosistema: [`FORGE614_ECOSYSTEM_CONTRACT.md`](../../FORGE614_ECOSYSTEM_CONTRACT.md)

---

## 1. Resumen Ejecutivo

Esta entrega consolida la transición arquitectónica de Forge614 Engram hacia un motor de memoria no visual desacoplado, completando las Tareas 2 y 3 del plan de convergencia del ecosistema, retirando de forma definitiva comandos legados obsoletos y delimitando formalmente el rol de Forge614 Shell durante el trabajo diario:

1. **Retiro Completo de `setup` (`COMMAND_RETIRED`):** El subcomando `forge614-engram setup` ha sido **completamente retirado** del binario público (no opera como un alias silencioso). Cualquier invocación emite por stderr el JSON estructurado `{"code": "COMMAND_RETIRED", "error": "El comando setup fue retirado. Usa forge614-engram init."}` con código de salida `1`.
2. **Comando Unificado de Inicialización `init`:**
   - **Modo Interactivo (`forge614-engram init`):** Requiere una terminal física interactiva (TTY en modo crudo). Si se detecta un entorno desatendido (no-TTY, pipes, redirecciones), aborta preventivamente con `INTERACTIVE_REQUIRED`. Guía paso a paso la configuración de almacenamiento, réplica opcional PostgreSQL, activación aditiva de refuerzo FTS5 y transiciona secuencialmente a `assistantTui`.
   - **Modo No Interactivo (`forge614-engram init --json`):** Bandera headless dedicada para scripts de aprovisionamiento, instaladores, contenedores y automatizaciones CI/CD. Nunca lee de stdin ni abre pantallas interactivas; inicializa el almacenamiento SQLite local de forma idempotente y emite `{"initialized": true, "storage": "sqlite"}` con código de salida `0`.
3. **Implementación de la Tarea 2 en el SDK (`applyMemoryInitialization`):** Función atómica exportada en la raíz del paquete (`src/index.ts`) que valida concurrencia mediante control optimista (`expectedRevision`), ejecuta pruebas de conexión previas a PostgreSQL antes de alterar archivos locales, asegura permisos restrictivos (`0700`/`0600`) y activa de forma aditiva e irreversible el refuerzo de búsqueda.
4. **Independencia Operativa y Rol de Forge614 Shell:** Se clarifica que Forge614 Shell es la interfaz visual de configuración inicial y bienvenida, pero **su ejecución es estrictamente opcional durante la jornada de trabajo**. Los asistentes de IA (ADE Orca, Claude Code, Codex, Antigravity) interactúan directamente con Engram a través de su servidor local MCP por entrada/salida estándar (stdio) sin requerir que Shell esté abierto.
5. **Estado de Pruebas:** 582 pruebas superadas y 15 omitidas en 92 archivos (597 pruebas totales, 2,781 aserciones, 0 fallos) en macOS ARM64 con Bun 1.3.8.

---

## 2. Retiro del Comando `setup` y Error `COMMAND_RETIRED`

Para evitar ambigüedades en contratos de CLI y converger hacia la nomenclatura estándar del ecosistema, `forge614-engram setup` fue clausurado de forma definitiva:

```typescript
// En src/interfaces/cli/commands.ts
if (command === "setup") {
  throw new MemoryError(
    "COMMAND_RETIRED",
    "El comando setup fue retirado. Usa forge614-engram init."
  );
}
```

### Garantías de Comportamiento:
- **Cero Aliasing Silencioso:** No redirige de forma transparente ni inicia pantallas inesperadas.
- **Salida JSON Estructurada:** Garantiza que herramientas externas, scripts o agentes que consuman la salida reciban un código de máquina inequívoco:
  ```json
  {
    "code": "COMMAND_RETIRED",
    "error": "El comando setup fue retirado. Usa forge614-engram init."
  }
  ```
- **Preservación Total del Disco:** No escribe en disco, no inicializa carpetas ni altera configuraciones existentes.

---

## 3. Arquitectura del Comando `forge614-engram init [--json]`

El nuevo comando `init` ofrece dos modalidades mutuamente excluyentes y deterministas:

| Propiedad | Modo Interactivo (`init`) | Modo Desatendido (`init --json`) |
| :--- | :--- | :--- |
| **Invocación** | `forge614-engram init` | `forge614-engram init --json` |
| **Requisito TTY** | Estricto (falla con `INTERACTIVE_REQUIRED` si no hay TTY) | Ninguno (opera en pipes, subshells y CI/CD) |
| **Lectura de Stdin** | Sí (preguntas guiadas y menús interactivos) | No (nunca lee ni bloquea stdin) |
| **Salida** | Pantallas enriquecidas TUI y transición a `assistantTui` | JSON plano: `{"initialized": true, "storage": "sqlite"}` |
| **Código de Salida** | `0` (éxito) / `1` (cancelación o error) | `0` (éxito idempotente) |
| **Caso de Uso** | Personas desarrolladoras configurando su máquina local | Scripts bash, instaladores, Dockerfiles, agentes |

### Flujo del Asistente Interactivo (`init`):
1. Invoca `config.repairExistingRoot()` para restringir a `0700` carpetas preexistentes propiedad del usuario.
2. Ejecuta `config.prepare()` para migrar atómicamente archivos legados sueltos desde `~/.forge614/` hacia `~/.forge614/engram/`.
3. Ofrece seleccionar almacenamiento (SQLite local como motor primario garantizado).
4. Ofrece configurar réplica opcional hacia PostgreSQL (solicitando URL segura con TLS).
5. Pregunta si se desea habilitar el refuerzo aditivo de búsqueda FTS5 (Esquema 7).
6. Al confirmar, transiciona limpiamente hacia el menú interactivo de asistentes (`assistantTui`) para conectar clientes de IA locales.

---

## 4. Implementación del SDK: `applyMemoryInitialization` (Tarea 2)

Exportada en `src/index.ts` y ubicada en `src/app/initialization.ts`, esta función proporciona a Forge614 Shell y al ecosistema la capacidad de aplicar de forma segura y atómica la configuración previamente acordada con la persona usuaria:

```typescript
export async function applyMemoryInitialization(
  request: MemoryInitializationRequest,
  expectedRevision: string | null,
  config: WorkspaceConfig = new WorkspaceConfig()
): Promise<MemoryInitializationResult>
```

### Tipo de Retorno (`MemoryInitializationResult`):
```typescript
export interface MemoryInitializationResult {
  status: MemoryInitializationStatus;
  initializedStorage: boolean;
  configuredPostgres: boolean;
  enabledReinforcement: boolean;
}
```

### Invariantes y Salvaguardas Críticas:
1. **Control Optimista de Concurrencia (OCC):**
   ```typescript
   if (config.revision() !== expectedRevision) {
     throw new MemoryError(
       "CONFIG_CHANGED",
       "La configuración cambió; genera una vista previa nueva antes de aplicar cambios."
     );
   }
   ```
   Si otro proceso, usuario o agente modificó el archivo `.env` mientras la persona leía la pantalla de confirmación en Shell, la operación se detiene inmediatamente sin tocar el disco.
2. **Prueba Transitoria Previa de PostgreSQL:**
   Si `request.postgresUrl` contiene una cadena, se ejecuta una conexión temporal de prueba antes de realizar modificaciones locales:
   ```typescript
   const replica = PostgresReplica.connect(request.postgresUrl, true);
   try {
     await replica.read();
   } finally {
     await replica.close();
   }
   ```
   Si la base de datos remota es inaccesible o las credenciales fallan, la operación aborta de inmediato sin dejar configuraciones corruptas o a medio aplicar.
3. **Inicialización Idempotente del Espacio:**
   Llama a `workspace.init()` para asegurar permisos restrictivos (`0700` en carpeta, `0600` en archivos) y crear la estructura base de SQLite si no existía, sin destruir recuerdos existentes.
4. **Refuerzo Aditivo (Sin Degradación):**
   Si `request.enableReinforcement` es `true` y el refuerzo no estaba activo, ejecuta `store.enableSearchReinforcement()`. Si es `false`, jamás degrada ni revierte un refuerzo ya activo (el refuerzo en Engram es permanente y estrictamente aditivo).
5. **Configuración Atómica de `.env`:**
   Aplica `config.configurePostgres(request.postgresUrl)` utilizando el cerrojo exclusivo `.config-lock` y escritura segura `0600`.

---

## 5. Independencia Operativa de Forge614 Shell

El commit `df26d8a` clarificó formalmente la frontera operativa entre Forge614 Shell y el motor de memoria:

```text
┌────────────────────────────────────────────────────────┐
│            Forge614 Shell (Visual Onboarding)          │  <- Solo en configuración inicial
└──────────────────────────┬─────────────────────────────┘
                           │ Configura vía SDK
                           ▼
┌────────────────────────────────────────────────────────┐
│               Forge614 Engram (~/.forge614/engram/)    │
│  - SQLite (engram.db) con FTS5                         │
│  - Servidor MCP Local por stdio                        │
└──────────────┬──────────────────────────┬──────────────┘
               ▲                          ▲
               │ Conexión stdio MCP       │ Conexión stdio MCP
┌──────────────┴─────────┐     ┌──────────┴──────────────┐
│  ADE Orca / Claude     │     │  Codex / Antigravity    │  <- Trabajo diario sin Shell
└────────────────────────┘     └─────────────────────────┘
```

### Principio de Operación Cotidiana:
- **Shell No Necesita Estar Abierto:** Una vez completada la inicialización de Engram y conectados los asistentes, la persona usuaria puede cerrar por completo Forge614 Shell.
- **Comunicación Directa por MCP:** Los entornos de desarrollo y asistentes de código (ADE Orca, Claude Code, Codex, Antigravity) generan subprocesos directos hacia el binario `forge614-engram` comunicándose por el protocolo estándar Model Context Protocol (MCP) a través de `stdin`/`stdout`.
- **Cero Sobrecarga de Recursos:** Engram no ejecuta demonios en segundo plano, puertos HTTP abiertos ni procesos residentes innecesarios.

---

## 6. Evidencia de Verificación y Pruebas

Verificación ejecutada en macOS ARM64 con Bun 1.3.8:

1. **Pruebas del SDK y CLI:**
   ```bash
   bun test src/index.test.ts src/interfaces/cli/__tests__/cli.e2e.test.ts
   # 20 pass, 0 fail (148 expect calls)
   ```
   Valida:
   - Exportación de `applyMemoryInitialization` en `src/index.ts`.
   - `retired setup tells the user to use init and leaves storage absent`.
   - `init requires a terminal while init --json stays noninteractive`.
   - `init rejects unknown flags without entering prompts or creating files`.
   - `init is repeatable and rename retains identity without per-project registration`.

2. **Pruebas de Inicialización y Sincronización:**
   ```bash
   bun test src/app/initialization.test.ts src/app/synchronization.test.ts
   # Todas las pruebas pasaron limpiamente
   ```
   Valida OCC con `CONFIG_CHANGED`, prueba transitoria de PostgreSQL, refuerzo aditivo y mensaje actualizado de `SYNC_DISABLED`.

3. **Suite Completa del Proyecto:**
   ```bash
   bun test
   # 582 pass, 15 skip across 92 files (597 total tests, 2,781 assertions, 0 failures)
   ```

4. **Verificación de Tipos TypeScript:**
   ```bash
   bun run typecheck
   # tsc --noEmit finalizado con código de salida 0 (sin errores de tipos)
   ```

5. **Verificación de Espacios y Formato:**
   ```bash
   git diff --check docs/
   # Limpio (código de salida 0)
   ```

---

## 7. Próximos Pasos en la Hoja de Ruta

Con las Tareas 1, 2 y 3 concluidas exitosamente, las fases pendientes del contrato de ecosistema son:
- **Tarea 4:** Desacoplamiento de la detección y configuración activa de asistentes hacia `forge614-engines`.
- **Tarea 5:** Retirada gradual de interfaces TUI locales en Engram en favor exclusivo de Forge614 Shell.
- **Fase 5:** Búsqueda híbrida y embeddings vectoriales locales.
- **Fase 6:** Explorador interactivo de recuerdos en terminal.
