# Centro de control TUI — Diseño técnico

Estado: implementado, verificado y revisado. Fecha: 2026-09-17.
Rama: `feat/tui-control-center`, creada desde `main` 614e104.

## Objetivo

Convertir `forge614-engram tui` en la entrada interactiva de administración de
Forge614 Engram. Debe mostrar el estado local sin alterar datos al abrirse y
ofrecer acciones explícitas, con vista previa y confirmación, para proyectos,
capacidades y sincronización. La configuración de asistentes existente se
conserva como un subflujo de la misma experiencia.

No es una interfaz gráfica, un servidor, un servicio en segundo plano ni una
segunda fuente de datos. SQLite sigue siendo la fuente local de verdad y el
MCP/CLI público conservan sus contratos.

## Límites y reglas invariantes

- Una sola configuración global y una sola base (`~/.forge614/.env` y
  `~/.forge614/engram.db`); la pantalla no crea una configuración o base al
  abrirse.
- Proyectos se separan por UUID `projectId`; sus nombres y directorios son
  etiquetas/relaciones, no identificadores sustitutos.
- Memoria `shared` sigue siendo explícita. La TUI no cambia sustitución de temas,
  visibilidad, propiedad, historial, FTS5 ni reglas de confirmaciones.
- No mostrar `POSTGRES_URL`, contenidos de `.env`, secretos, recuerdos completos
  ni contenido de archivos de configuración de asistentes. Las rutas y nombres
  que se muestren pasan por el mismo saneamiento de control/ANSI/bidi actual.
- No usar embeddings, LLM, nuevas dependencias, red adicional, migraciones
  implícitas ni credenciales reales en pruebas.
- Antes de la confirmación final, una cancelación, `Escape`, `Ctrl+C`, EOF, un
  TTY ausente o una entrada inválida no escribe nada. Si la operación ya fue
  confirmada e inició, la TUI restaura raw mode, cursor y pantalla, pero no
  promete revertir esa operación en curso.
- Toda escritura se hace mediante `MemoryWorkspace`, `MemoryStore`,
  `syncWorkspace` y el flujo de asistentes existente; no habrá SQL, escrituras
  de `.env` ni manipulación de ficheros directamente desde `interfaces/tui`.
- La documentación bilingüe y Notion se entregan como prompt de handoff; no se
  actualizan aquí. No commit, push, PR, merge ni borrado de ramas.

## Enfoques evaluados

1. Extender la TUI de asistentes con todos los datos y operaciones. Reutiliza
   teclas, pero mezclaría el ciclo de vida de archivos de asistentes con proyectos
   y SQLite; se volvería una pantalla con responsabilidades incompatibles.
2. Crear múltiples comandos TUI independientes (`tui-projects`, `tui-storage`).
   Aísla código, pero obliga a conocer comandos y no entrega el panel central que
   pidió el usuario.
3. Recomendado: un controlador de centro con páginas de lectura y un flujo de
   acciones, que delega la configuración de asistentes a la sesión actual
   `AssistantSession`. Conserva límites de responsabilidad: aplicación prepara
   un resumen seguro, interfaz navega/renderiza, y adaptadores conservan I/O.

## Arquitectura

```text
CLI `tui`
  -> interfaces/tui/control-center.ts (TTY, teclas, ciclo de pantalla)
       -> interfaces/tui/control-center-render.ts (texto acotado y saneado)
       -> app/control-center.ts (lectura y acciones coordinadas)
            -> MemoryWorkspace / MemoryStore / WorkspaceConfig / syncWorkspace
            -> app/assistants.ts (flujo de asistentes existente)
  -> interfaces/tui/controller.ts + render.ts (selector/configurador existente)
```

`app/control-center.ts` es una fachada de casos de uso. Devuelve tipos pequeños
sin secretos y abre/cierra un `MemoryStore` dentro de cada operación. La consulta
de estadísticas vive en `infrastructure/sqlite/projects.ts`; su prueba hermana
ejecuta SQLite real. No se filtran SQL ni conexiones hacia `interfaces/tui`.

La entrada `tui` ejecuta un bucle de alto nivel: abre el control center; si el
usuario escoge asistentes, cierra/restaura la primera sesión y abre la TUI de
asistentes existente; al volver, redibuja el centro. Así no hay dos lectores raw
ni dos dueños de la pantalla activos simultáneamente.

## Datos de lectura

La carga inicial es estrictamente read-only. Si no hay configuración, muestra un
estado «sin inicializar» y la acción solo explica que se ejecute `setup` o `init`;
no crea archivos desde la TUI.

Cuando existe una base compatible, `ControlCenterSnapshot` contiene:

```ts
type CapabilityState = {
  schema: 3 | 4 | 5 | 6 | 7;
  assistantIntegration: boolean;
  sessions: boolean;
  reinforcement: boolean;
};
type ProjectSummary = {
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  bindings: string[];
  memories: { active: number; archived: number; lastUpdatedAt: string | null };
};
type SharedSummary = { active: number; archived: number; lastUpdatedAt: string | null };
type StorageSummary = {
  initialized: boolean;
  databasePath: string | null;
  capabilities: CapabilityState | null;
  postgres: "not-configured" | "configured";
};
type ControlCenterSnapshot = {
  storage: StorageSummary;
  projects: ProjectSummary[];
  shared: SharedSummary | null;
};
```

Las fechas y contadores describen metadatos, no contenido de recuerdos. Los
directorios vinculados ya son metadatos locales de proyecto y se muestran solo al
usuario local en su terminal; no se sincronizan a PostgreSQL.

## Páginas y teclas

El inicio enseña cinco elementos, más salir: `Resumen`, `Proyectos`, `Shared`,
`Almacenamiento`, `Acciones`, `Asistentes`, `Salir`. Flechas mueven foco; Enter
abre; Escape vuelve; Ctrl+C/EOF cancela toda la sesión; PgUp/PgDn desplazan texto.
El render limita ancho/alto, usa ASCII seguro y nunca emite datos secretos.

- **Resumen:** estado de base, capacidades, total de proyectos y resumen shared.
- **Proyectos:** lista nombre/UUID abreviado/conteos. El detalle muestra UUID
  completo, fechas, directorios vinculados y conteos. No revela recuerdos.
- **Shared:** conteos activo/archivado y última actualización; explica que es una
  sola colección global, no una base por proyecto.
- **Almacenamiento:** ruta SQLite, esquema y si PostgreSQL está configurado, sin
  URL ni resultado inventado de conectividad.
- **Asistentes:** delega al configurador existente; conserva previsualización,
  validación, confirmación, copias y autoprueba existentes.
- **Acciones:** muestra acciones y consecuencias antes de pedir datos. No se
  dispara por navegar.

## Acciones confirmadas

1. Crear proyecto: pide nombre saneado, muestra nombre antes de confirmar, llama
   `MemoryWorkspace.createProject`; genera el UUID actual. No crea un proyecto
   por abrir una pantalla.
2. Renombrar: se selecciona un proyecto existente, se solicita nuevo nombre y se
   confirma junto con UUID; usa `MemoryWorkspace.renameProject`.
3. Vincular directorio: se selecciona proyecto, se solicita ruta absoluta y se
   confirma; usa `MemoryStore.bindProjectDirectory`. La validación/canonización
   existente es autoridad. No se adivina proyecto por nombre.
4. Habilitar integración, sesiones o refuerzo: muestra esquema destino y que no
   existe downgrade. Solo lista capacidades todavía apagadas; cada una necesita
   confirmación. La cadena de migraciones existente conserva recuerdos.
5. Sincronizar ahora: se muestra únicamente cuando PostgreSQL está configurado,
   exige confirmación y llama a `syncWorkspace`. No promociona formato: si hace
   falta, presenta el error seguro y remite al comando explícito
   `sync --upgrade-format`. No ejecuta `sync-watch` ni instala un servicio.

Tras una escritura correcta, recarga el snapshot. Ante error, muestra código y
mensaje seguro sin borrar pantalla ni datos. Toda operación se cierra y no
mantiene base abierta durante la interacción.

## Pruebas

- `projects.test.ts`: estadísticas por proyecto/shared, archivos y proyecto sin
  recuerdos; no contenido ni cruces de propietario.
- `control-center.test.ts`: facade read-only, configuración ausente, capacidades,
  acciones mediante workspace real temporal, rechazo seguro y cierre de store.
- `control-center-render.test.ts`: límites minúsculos, saneamiento ANSI/bidi,
  ausencia de secretos/contenido, foco y scroll.
- `control-center.test.ts` de interfaz: transiciones de teclas, cancelar sin
  escrituras, confirmaciones, refresco y delegación a asistentes sin raw-mode
  anidado.
- integración/e2e TTY: non-TTY falla `INTERACTIVE_REQUIRED` sin escribir;
  PTY cancela/restaura terminal. Usar homes/configuraciones temporales y nunca la
  base del usuario.

Cada archivo con lógica lleva su prueba hermana; flujos entre capas se colocan en
`__tests__` local. Ninguna suite importa otra suite.

## Criterios de aceptación

1. `forge614-engram tui` abre el panel de lectura con configuración existente,
   y sin configuración no crea archivos.
2. Proyectos, shared, capacidades y estado PostgreSQL se muestran sin secretos ni
   contenido de recuerdos; los datos pertenecen al dueño correcto.
3. Ninguna acción modifica datos hasta la confirmación final; cancelar deja bytes
   de configuración y base idénticos.
4. Crear, renombrar y vincular usan los contratos existentes y actualizan la
   pantalla. Capacidades son explícitas y repetibles.
5. Sincronización y asistentes conservan sus barreras explícitas y su privacidad.
6. TTY, resize, Ctrl+C, Escape, EOF, pantallas pequeñas, errores y rutas
   maliciosas se comportan de manera segura.
7. Pruebas focalizadas, suite completa, typecheck y `git diff --check` pasan.
