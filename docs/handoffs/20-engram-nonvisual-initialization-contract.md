# Handoff técnico 20: Contrato no visual de inicialización y vista previa para el ecosistema Forge614 (Task 1)

Fecha de verificación: 2026-09-19 (UTC).
Rama: `feat/engram-nonvisual-initialization` (basada en `main` tag `v1.1.0-beta.2`).
Versión base: 1.1.0-beta.2.
Commits clave de la entrega:
- `9996ef1`: `docs: define Forge614 ecosystem transition`
- `3d94b29`: `feat: expose nonvisual memory initialization preview`

Plan de implementación: [`docs/superpowers/plans/2026-09-19-engram-nonvisual-transition.md`](../superpowers/plans/2026-09-19-engram-nonvisual-transition.md)
Contrato rector de ecosistema: [`FORGE614_ECOSYSTEM_CONTRACT.md`](../../FORGE614_ECOSYSTEM_CONTRACT.md)

---

## 1. Contexto del Ecosistema y Motivación

Con la formalización del Contrato de Ecosistema de Forge614 (`FORGE614_ECOSYSTEM_CONTRACT.md`), la suite define una división de responsabilidades estricta entre productos independientes:

```text
forge614-ai                         Núcleo y orquestador del ecosistema (futuro dueño de forge614 init)
├─ forge614-shell                   La única experiencia visual para la persona usuaria
├─ forge614-engines                 Descubrimiento y adaptadores de IAs instaladas (dependencia interna)
├─ forge614-engram                  Motor de memoria persistente (SQLite, FTS5, réplica opcional, MCP y SDK)
└─ forge614-atlas                   Contextualización profunda de repositorios (deposita en Engram)
```

### Reglas Rectoras del Ecosistema:
1. **Una Sola Experiencia Visual:** Forge614 Shell es la única interfaz visual interactiva (pantallas, TUI, confirmaciones y preguntas). Ningún otro producto debe mantener su propia interfaz visual a largo plazo.
2. **Engram es un Motor de Memoria, no una Interfaz:** Engram es dueño exclusivo de su almacenamiento bajo `~/.forge614/engram/`, SQLite, FTS5, identidades de proyecto (`projectId`), sesiones y sincronización opcional con PostgreSQL. No debe gestionar pantallas de terminal ni interactuar directamente con el usuario cuando opera dentro del ecosistema.
3. **Propiedad de Comandos Globales:** El comando global futuro `forge614 init` pertenecerá a `forge614-ai`. Ningún otro componente (incluyendo Engram) debe arrogarse la propiedad ni la implementación de `forge614 init`.
4. **Coexistencia Transicional:** Durante esta etapa de transición, el asistente interactivo `forge614-engram setup` y el Centro de Control `forge614-engram tui` (`src/interfaces/terminal/`) continúan plenamente operativos para compatibilidad hacia atrás. La migración hacia Shell se produce desacoplando la lógica de inicialización en contratos programáticos no visuales.

---

## 2. Implementación de la Tarea 1: Inspección y Vista Previa No Visual

La Tarea 1 implementa el núcleo no visual de consulta y proyección segura en `src/app/initialization.ts`, expuesto directamente a través del SDK público en `src/index.ts`.

### 2.1. Tipos de Datos Tipados (`src/app/initialization.ts`)

```typescript
export interface MemoryInitializationStatus {
  initialized: boolean;
  storage: "sqlite";
  postgresConfigured: boolean;
  reinforcementEnabled: boolean;
}

export interface MemoryInitializationRequest {
  postgresUrl: string | null;
  enableReinforcement: boolean;
}

export interface MemoryInitializationPreview {
  status: MemoryInitializationStatus;
  expectedRevision: string | null;
  initializesStorage: boolean;
  configuresPostgres: boolean;
  enablesReinforcement: boolean;
}
```

### 2.2. `inspectMemoryInitialization(config?: WorkspaceConfig): MemoryInitializationStatus`
- **Propósito:** Inspeccionar de forma pasiva el estado actual del espacio de almacenamiento de Engram.
- **Comportamiento y Salvaguardas:**
  1. Si `~/.forge614/engram/` o su archivo de base de datos no existen, retorna `{ initialized: false, storage: "sqlite", postgresConfigured: false, reinforcementEnabled: false }`.
  2. **100% Libre de Efectos Secundarios:** No crea carpetas, no crea `.env`, no crea `engram.db`, y no crea proyectos ni recuerdos.
  3. **Apertura de SQLite en Solo Lectura:** Si la base existe, abre la conexión con `open(true)` (modo de solo lectura estricto), consulta si la tabla `confirmations` (Esquema 7) existe, y cierra la conexión de inmediato dentro de un bloque `finally`.
  4. **Protección de Credenciales:** Evalúa si `POSTGRES_URL` está configurada en `.env` devolviendo únicamente una bandera booleana (`postgresConfigured: true/false`). La URL y contraseñas jamás se exponen en la respuesta.

### 2.3. `previewMemoryInitialization(request: MemoryInitializationRequest, config?: WorkspaceConfig): Promise<MemoryInitializationPreview>`
- **Propósito:** Proyectar con precisión qué cambios se aplicarán si el usuario confirma la operación en Forge614 Shell.
- **Comportamiento y Salvaguardas:**
  1. Obtiene el estado actual llamando internamente a `inspectMemoryInitialization(config)`.
  2. Lee la huella o sello de versión actual mediante `config.revision()` (`expectedRevision`). Esto actúa como mecanismo anti-carreras: permite a Shell verificar posteriormente que nadie haya editado `.env` mientras el usuario leía la pantalla de confirmación.
  3. **Validación Sintáctica Local:** Si se provee una cadena en `request.postgresUrl`, la valida mediante `postgresOptions(trimmed)`. Si la URL es sintácticamente inválida, arroja un error tipado descriptivo antes de procesar cualquier otra acción.
  4. **Cero Conexiones Remotas:** No abre sockets TCP ni envía paquetes de red a servidores PostgreSQL durante la vista previa.
  5. **Cero Escritura en Disco:** No crea directorios ni altera tablas en SQLite.
  6. **Proyección Estructurada de Banderas:**
     - `initializesStorage`: `true` si `!status.initialized`.
     - `configuresPostgres`: `true` si la URL solicitada difiere de la URL ya configurada en `.env`.
     - `enablesReinforcement`: `true` si se solicitó habilitar refuerzo (`enableReinforcement: true`) y este no estaba activo previamente (`!status.reinforcementEnabled`).
  7. **Protección de Secretos:** La URL de PostgreSQL no se devuelve en el objeto `MemoryInitializationPreview`, previniendo fugas accidentales en interfaces o registros de depuración (*logs*).

---

## 3. Superficie Pública del SDK (`src/index.ts`)

Las funciones y tipos fueron incorporados en:
1. `src/app/index.ts`: Re-exporta `inspectMemoryInitialization`, `previewMemoryInitialization` y los tipos asociados.
2. `src/index.ts`: Exporta las funciones y tipos en la raíz del paquete `forge614-engram`.
3. `src/index.test.ts`: Prueba de contrato del SDK ampliada a 5 pruebas para verificar en tiempo de ejecución que las nuevas funciones son invocables y que los tipos TypeScript compilan correctamente.

---

## 4. Evidencia de Pruebas y Verificación

Todas las verificaciones se completaron con 0 fallos en macOS ARM64 con Bun 1.3.8:

1. **Pruebas Unitarias del Módulo de Inicialización:**
   ```bash
   bun test src/app/initialization.test.ts
   # 15 pruebas superadas, 0 fallos
   ```
   Cubre: estado no inicializado sin efectos secundarios, estado existente local, detección de réplica PostgreSQL, detección de Esquema 7, proyecciones de vista previa para almacenamiento nuevo, actualizaciones de réplica, idempotencia de refuerzo, validación de sintaxis de PostgreSQL URL, y no fuga de credenciales.

2. **Prueba de Contrato del SDK:**
   ```bash
   bun test src/index.test.ts
   # 5 pruebas superadas, 0 fallos
   ```

3. **Suite Completa del Proyecto:**
   ```bash
   bun test
   # 592 pruebas superadas, 15 omitidas (dependientes de Windows/PG local) en 92 archivos
   ```

4. **Verificación de Tipos TypeScript:**
   ```bash
   bun run typecheck
   # tsc --noEmit finalizado con código de salida 0 (limpio)
   ```

5. **Verificación de Formato y Espacios:**
   ```bash
   git diff --check
   # Limpio (código de salida 0)
   ```

---

## 5. Fronteras de la Entrega y Próximos Pasos

- **Alcance Estricto de la Tarea 1:** Esta entrega proporcionó exclusivamente inspección pasiva y cálculo de vista previa.
- **Continuación en Handoff 21:** Las Tareas 2 (`applyMemoryInitialization`) y 3 (`forge614-engram init [--json]`), junto al retiro formal de `setup` (`COMMAND_RETIRED`) y la clarificación de Shell runtime, fueron completadas e integradas formalmente en el [Handoff Técnico 21](21-engram-init-command-and-apply-initialization.md).
- **Tarea 4 (Pendiente):** Desacoplará la detección de asistentes hacia `forge614-engines`.
- **Tarea 5 (Pendiente):** Retirará gradualmente las interfaces visuales propias en favor de Forge614 Shell.
