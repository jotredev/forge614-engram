# Entrega 10 — Monolito modular

Fecha: 2026-09-17. Base: `e28ca32`, versión `0.5.0`. Implementación sin commit ni push. Este documento entrega evidencia e instrucciones al modelo que actualizará `docs/es`, `docs/en` y Notion; esta entrega no modifica esas superficies.

Corrección aprobada por el usuario: las pruebas se organizan junto a sus implementaciones (colocated tests), no en árboles globales `tests/unit` y `tests/integration`. Cada archivo con lógica tiene su propio `<nombre>.test.ts`; la colaboración se prueba adicionalmente en `__tests__` de la funcionalidad. Los resultados de la primera reorganización se conservan como historial, separados de la verificación de esta corrección.

## Patrón real, decisión y límites

Forge614 Engram sigue siendo un solo programa desplegable: un **monolito modular por funcionalidad** (feature-oriented modular monolith), con coordinación de aplicación y adaptadores explícitos. Memoria, proyectos, sesiones, búsqueda, sincronización, espacio global y asistentes tienen contratos propios. CLI, MCP y TUI comparten aplicación y almacenamiento.

Antes, la raíz de `src` mezclaba SQL, configuración, terminal, MCP y reglas. `MemoryStore` reunía proyectos, versiones, sesiones, búsqueda y réplica; la TUI resolvía instalación y archivos; los tests dependían de rutas profundas y relativas. Ahora la fachada delega en operaciones concretas y la escritura compuesta conserva una sola conexión y una transacción exterior.

Las capas globales (layered architecture) habrían separado modelos/servicios/repositorios, dispersando cada funcionalidad. La arquitectura hexagonal estricta (hexagonal architecture) añadiría contratos y adaptadores para casi toda interacción: su sustituibilidad no justifica aquí un repositorio genérico, contenedor de inyección ni paquetes nuevos. Se conservan límites útiles sin afirmar DDD completo, microservicios o hexagonal estricta.

Costes: mantener contratos públicos, clasificar cambios y comprobar imports; algunas políticas ligadas a SQL siguen junto a la operación transaccional. No todo componente es intercambiable automáticamente. Las carpetas no eliminan errores ni distribuyen procesos. No se incorpora búsqueda semántica, embeddings, aprendizaje automático ni mejora demostrada de calidad de búsqueda.

## Árbol implementado y responsabilidades

```text
src/
  cli.ts                         entrada de dos líneas: importa main y lo ejecuta
  index.ts                       exportaciones explícitas del SDK público
  app/
    index.ts                     entrada interna de flujos para las interfaces
    memory-store.ts               fachada síncrona compatible; conexión por instancia
    workspace.ts                 ciclo de vida del espacio global
    project-context.ts           coordina identidad Git y vínculos locales
    synchronization.ts           lectura, reconciliación, CAS y aplicación
    setup.ts                     configuración mediante el contrato SetupIO
    assistants.ts                descubrimiento/configuración/autoprueba
  modules/
    memory/{index,types}.ts
    projects/{index,identity,types}.ts
    sessions/{index,rules,types}.ts
    search/{index,rules,types}.ts
    synchronization/{index,snapshot}.ts
    workspace/{index,types}.ts
    assistants/{index,catalog,protocol,templates,tools}.ts
  infrastructure/
    sqlite/{connection,schema,workspace-database}.ts
    sqlite/{projects,memory,sessions,search,writes,snapshots}.ts
    postgres/replica.ts
    filesystem/{paths,workspace-config,private-files}.ts
    git/project-directory.ts
    assistants/{catalog,configuration,installation,self-test}.ts
  interfaces/
    cli/{main,arguments,help,commands}.ts
    mcp/{server,schemas,tools,context,project-directory}.ts
    mcp/{memory-tools,sessions-tools}.ts
    tui/{controller,render}.ts
    terminal/{setup,sync-watch,hooks}.ts
  shared/errors.ts               única identidad de MemoryError
tests/
  architecture/                  auditor TypeScript, límites, ciclos y árbol real
  e2e/                           instalación completa y SQLite/CLI/PostgreSQL global
  fixtures/                      preloads aislados, PTY, SDK y snapshot histórico
scripts/install.sh               compila src/cli.ts; mismo nombre del ejecutable
```

Dentro de `src`, los archivos con lógica tienen pruebas hermanas `*.test.ts`. Las carpetas `__tests__` de aplicación e interfaces contienen flujos conjuntos `*.integration.test.ts` o `*.e2e.test.ts`; sus recursos privados usan `__test-support__`. `src/index.test.ts` verifica el contrato público. No exportar pruebas o helpers desde las entradas de producción.

`modules/*/index.ts` publica entradas explícitas de conceptos; sus archivos internos no son entradas de otros módulos. `search/rules.ts` conserva términos/límites; la consulta FTS y las proyecciones están en `sqlite/search.ts`. `sqlite/writes.ts` controla las transacciones compuestas; `sqlite/memory.ts`, `projects.ts` y `sessions.ts` colaboran sobre la misma conexión. `mcp/server.ts` conserva apertura diferida y cierre; `schemas.ts` contiene los esquemas Zod; `tools.ts` conecta catálogo y familias; `context.ts` formatea resultados/errores. `project-directory.ts` interpreta raíces MCP y protege la selección implícita. TUI controla teclado/cancelación y render acotado, usando `app` para los servicios de asistentes.

## Mapa antes/después

| Origen | Dueño final |
| --- | --- |
| `domain.ts`, `identity.ts` | `modules/memory`, `modules/projects`, `shared/errors.ts` |
| `session-types.ts`, `sessions.ts` | `modules/sessions`, `infrastructure/sqlite/sessions.ts` |
| `retrieval-types.ts`, `retrieval.ts` | `modules/search`, `infrastructure/sqlite/search.ts` |
| `store.ts` | `app/memory-store.ts`, operaciones SQLite por concepto, `sqlite/writes.ts` |
| `schema.ts` | `infrastructure/sqlite/schema.ts` |
| `sync-snapshot.ts`, `sync-local.ts` | `modules/synchronization`, `sqlite/snapshots.ts` |
| `sync-postgres.ts` | `infrastructure/postgres/replica.ts` |
| `synchronize.ts`, `sync-runner.ts` | `app/synchronization.ts`, `interfaces/terminal/sync-watch.ts` |
| `paths.ts`, `workspace-config.ts`, `workspace-database.ts` | `infrastructure/filesystem`, `sqlite/workspace-database.ts` |
| `workspace.ts`, `project-context.ts` | `app/workspace.ts`, `app/project-context.ts`, `infrastructure/git` |
| `setup.ts`, `setup-terminal.ts` | `app/setup.ts`, `interfaces/terminal/setup.ts` |
| `cli.ts` | entrada estable y `interfaces/cli` |
| `mcp.ts`, `mcp-tools.ts` | `interfaces/mcp`, catálogo `modules/assistants/tools.ts` |
| `memory-protocol.ts` | `modules/assistants/protocol.ts` |
| `assistants/catalog.ts`, `configuration.ts`, `files.ts` | reglas en `modules/assistants`; I/O en `infrastructure/assistants` y `filesystem`; coordinación en `app/assistants.ts` |
| `assistants/hooks.ts` | plantillas en `modules/assistants/templates.ts`; stdin/stdout en `interfaces/terminal/hooks.ts` |
| `assistant-self-test.ts` | `infrastructure/assistants/self-test.ts` |
| `assistant-tui.ts`, `assistant-tui-render.ts` | `interfaces/tui/controller.ts`, `render.ts` |
| tests de raíz | Pruebas propias junto al archivo; colaboración en `__tests__` de su funcionalidad; solo comprobaciones transversales en `tests` |

Solo `src/index.ts` y `src/cli.ts` conservan rutas públicas. No quedan wrappers de compatibilidad antiguos. Quien importara archivos internos antiguos debe actualizar sus imports. La API pública, los tipos exportados, constructor, métodos y retornos síncronos de `MemoryStore` se mantienen; `tests/fixtures/sdk-contract.ts` comprueba los nombres/firmas y `src/index.test.ts` el inventario runtime. El recurso SQLite no se exporta por el SDK.

## Dependencias y ejemplos

Interfaces → entrada `app/index.ts`, entradas de módulos y `shared`. App → módulos/adaptadores/shared. Infraestructura → módulos/shared y colaboración entre adaptadores. Módulos → reglas/tipos permitidos y shared; nunca disco, procesos, SQL, app o interfaces. `shared` no depende de capas superiores. Ningún archivo interno importa el SDK raíz. CLI puede componer MCP, TUI y terminal; la aplicación nunca importa esas interfaces. Los imports de tipos también cuentan.

Entre conceptos: `memory → projects`; `sessions → memory/projects`; `search → memory/sessions/projects`; `synchronization → memory/sessions/projects`. `workspace` y `assistants` no crean dependencias de retorno. Primitivas puras existentes `node:crypto` y `node:util` se permiten en módulos. El auditor acepta imports/reexports, `require`, import-equals, consultas de tipos e imports dinámicos literales, incluidos templates sin sustitución; usa resolución TypeScript y detecta ciclos entre componentes. No evalúa rutas dinámicas calculadas ni demuestra ausencia de efectos laterales por análisis de llamadas.

Ejemplos desde `src/interfaces/cli/commands.ts`:

```ts
import { MemoryWorkspace } from "../../app";             // permitido
import { projectIdentity } from "../../modules/projects"; // permitido
import { startMcp } from "../mcp/server";                // composición permitida
// Prohibido: ../../app/workspace (saltaría la entrada de app)
// Prohibido: ../../modules/projects/identity (detalle interno)
// Prohibido: ../../infrastructure/sqlite/writes o bun:sqlite
```

Un ciclo `CLI → MCP → CLI` se rechaza: haría que el transporte dependiera de su propio consumidor y complicaría inicialización/cambios. También se rechaza `app → infraestructura → app`, aunque alguna arista fuera únicamente de tipos.

## Recorridos conservados

**Guardar por MCP:** stdio en `server.ts` → esquema en `schemas.ts` → `memory-tools.ts` valida intención global/selección → `app/project-context.ts` coordina Git y vínculo → fachada `MemoryStore` → `sqlite/writes.ts`. La transacción exterior comparte conexión con resolución/creación de proyecto, vínculo, recuerdo, versión, evento, request y entrada de sesión. Resumen y puntero se actualizan dentro de esa operación. Replay conserva su orden de validación, no añade escrituras ni cambia origen/puntero. MCP devuelve el resultado formateado; CLI usa la misma fachada conservando su política existente.

**Buscar:** argumentos CLI/esquema MCP → fachada → contratos/términos/límites de `modules/search` y consulta/proyección de `sqlite/search.ts`. SQLite ejecuta FTS y conserva orden/puntuación literal. MCP entrega previews; CLI conserva lectura completa por defecto y `--preview` explícito. Proyectos, shared, sustitución de temas y límites Unicode/bytes no cambian.

**Sincronizar:** `app/synchronization.ts` abre recursos mediante adaptadores, obtiene snapshot local/checkpoint/remoto → `modules/synchronization` valida y reconcilia valores → comprueba capacidades/promoción → publica PostgreSQL con CAS (compare-and-swap) → aplica local/checkpoint transaccionalmente. Los archivos locales y vínculos de máquina quedan fuera de réplica. Conflictos/rollback y autorización explícita de promoción se conservan. `interfaces/terminal/sync-watch.ts` posee espera, señales y salida; guardar local no depende de sincronizar.

## Dónde poner un cambio

| Cambio | Ubicación y comprobación |
| --- | --- |
| Nueva regla pura de memoria | `modules/memory`; exportar solo si cruza límite, test unitario; regla que requiere estado SQLite se verifica también en integración |
| Nuevo comando | `interfaces/cli/arguments.ts`, `help.ts`, `commands.ts`; flujo reutilizable en `app`; prueba e2e |
| Nueva herramienta MCP | catálogo `modules/assistants/tools.ts`, esquema y familia de handler en `interfaces/mcp`; contrato independiente e2e |
| Consulta SQL | adaptador SQLite del concepto; si modifica varias entidades, transacción exterior en `writes.ts`; SQLite real y rollback |
| Pantalla/tecla | `interfaces/tui/controller.ts` y `render.ts`; efectos vía app; componentes y PTY |
| Futuro proveedor de embeddings | diseñar contratos de recuperación en `modules/search`, I/O del proveedor en infraestructura, coordinación en app; requiere otra entrega y decisiones propias |

No añadir un repositorio genérico o módulo vacío para cada operación. El proveedor futuro es una ubicación posible, no una capacidad implementada ni una mejora de resultados medida.

## Pruebas propias y pruebas de colaboración

La unidad de organización es el dueño del comportamiento, no el tipo de prueba. Una prueba puede usar dependencias reales sin dejar de comprobar la responsabilidad de un archivo concreto.

```text
src/infrastructure/sqlite/
  memory.ts
  memory.test.ts
  sessions.ts
  sessions.test.ts
  writes.ts
  writes.test.ts
src/app/
  memory-store.ts
  memory-store.test.ts
  __tests__/
    sessions.integration.test.ts
    sync.integration.test.ts
```

`memory.test.ts` verifica las operaciones que implementa `memory.ts`; `writes.test.ts` prueba las decisiones de escritura y sus transacciones. La suite conjunta de sesiones comprueba la colaboración entre fachada, almacenamiento y sesiones. Pasar por `memory.ts` durante esa colaboración no sustituye su archivo propio de pruebas. Las suites importan implementaciones, nunca otros `.test.ts`. Cada archivo puede contener varios casos relacionados; no se crea un archivo por cada llamada a `test(...)`.

Los archivos exclusivamente de tipos, valores estáticos o reexportaciones no requieren pruebas artificiales. El arranque mínimo `src/cli.ts` delega en `interfaces/cli/main.ts` y se verifica además con la instalación del ejecutable. El código de `main.ts` sí tiene su propia suite. Mantener esa excepción acotada; no usarla para excluir archivos que incorporen lógica.

`tests/architecture/test-layout.test.ts` comprueba la correspondencia física para archivos con comportamiento; `import-rules` rechaza dependencias de producción hacia pruebas/helpers y que una suite importe otra suite. Esto no demuestra cobertura del 100% de ramas o escenarios: las aserciones significativas y las pruebas de colaboración siguen siendo necesarias. Los tests no se incluyen en el ejecutable mediante imports de producción.

## Evidencia y ejecución segura

Baseline inicial observado: **250 pass, 0 fail, 1506 assertions**, PostgreSQL desechable real (31.63 s). Tras Task 3: **271 pass, 0 fail, 1553 assertions**. Primera suite completa tras reorganizar interfaces/tests: **274 pass, 0 fail, 1558 assertions**, 32.32 s. Después se amplió la cobertura del auditor con consultas de tipos, índices internos, acceso SQLite directo y direcciones de conceptos; el resultado final se registra debajo y en el reporte Task 4.

```sh
FORGE614_TEST_POSTGRES_BIN=/tmp/engram-postgres-17.6.tTVxxc/postgres/bin bun test
bun run typecheck
git diff --check
bun test tests/architecture src/modules src/shared
bun test tests/e2e/install.test.ts
```

Resultado del controlador al cerrar Task 4: **286 pass, 0 fail, 1580 assertions**, 30 archivos, **32.52 s**, sin skips, con PostgreSQL real, instalación compilada y PTY. `bun run typecheck` y `git diff --check`: exit 0. Después, la auditoría añadió tres casos de arquitectura, sin cambiar producto. La revisión final independiente dio **PASS** de especificación y calidad, sin hallazgos críticos ni importantes; sus dos observaciones menores de limpieza/documentación quedaron resueltas en el pulido final. La suite completa ejecutada por ese pulido —no una nueva ejecución del controlador— terminó con **289 pass, 0 fail, 1583 assertions**, 30 archivos, **32.98 s**, sin skips y con PostgreSQL real. El `typecheck` y `git diff --check` frescos de este pulido también terminaron con exit 0. La evidencia detallada está en `.superpowers/sdd/2026-09-17-modular-architecture/final-polish-report.md`.

La ruta PostgreSQL es temporal de esta sesión. Si ya no existe, preparar binarios desechables explícitos; nunca usar `DATABASE_URL` ni la base del usuario. Los tests PostgreSQL crean sus propios clusters/puertos y los eliminan. Sin esa variable se omiten casos PostgreSQL: no presentar ese resultado como validación completa. E2E construye/instala en temporales con HOME/configuración aislados, incluyendo handshake MCP, sesiones, hooks y PTY real. Los casos SQLite `:memory:` son integración, no unitarios. El fixture formato 1 mantiene atribución `193e89a` y lógica histórica; solo cambiaron sus imports. Los casos que comprueban configuración generada y el catálogo esperado MCP siguen independientes de producción.

No cambió versión/dependencias, DDL, application_id, formatos SQLite 3/4/5/6 o snapshots 1/2, configuración global, instalación, nombre del binario, mensajes, esquemas MCP, permisos, privacidad, puntuación o comportamiento de sesiones/sincronización. `initialize` y `listTools` MCP continúan sin abrir/escribir base. La limitación de compatibilidad es el import profundo de archivos internos eliminados.

### Cierre anterior de la primera reorganización

Después de la limpieza y su revisión independiente, el controlador repitió la suite completa con PostgreSQL desechable: **289 pass, 0 fail, 1583 assertions**, 30 archivos, **32.83 s**, sin pruebas omitidas. `bun run typecheck && git diff --check` terminó con código 0. La revisión global y la revisión acotada de las dos correcciones menores quedaron aprobadas. Este resultado es el baseline anterior a la corrección de pruebas colocadas, no una medición de esa corrección. La rama permanece sin commit, staging ni push.

### Verificación de la corrección de pruebas colocadas

El controlador ejecutó la suite completa final tras la corrección y la revisión con PostgreSQL desechable: **369 pass, 0 fail, 1891 assertions**, **69 archivos**, **33.49 s**, sin pruebas omitidas; incluyó instalación del binario y terminal real (PTY). `bun run typecheck` y `git diff --check` terminaron con código 0. Los **46 archivos de implementación con lógica** tienen su prueba propia hermana; el contrato del SDK tiene además `src/index.test.ts`. Esto no equivale a una afirmación de cobertura del 100% de ramas.

Se compararon los archivos de producción contra el estado anterior a esta corrección: no cambiaron sus bytes. Se conservaron los casos existentes; la comprobación conjunta de Unicode/resumen/búsqueda se repartió en tres pruebas específicas de sus dueños, conservando las aserciones originales. La primera ejecución de esta corrección había tenido 370 casos; se consolidaron dos nuevos casos duplicados de plantillas dentro de los originales y se añadió un caso de arquitectura: el total final es 369, sin pérdida de comportamiento probado. La revisión independiente y las revisiones acotadas de sus correcciones están aprobadas, sin hallazgos pendientes. El control de colocación detecta también expresiones calculadas, condiciones y valores por defecto en desestructuraciones, no solo funciones.

## Prompt listo para copiar / Ready-to-paste prompt

```text
Actualiza docs/es, docs/en y las páginas correspondientes de Notion para la
Entrega 10 de Forge614 Engram. No hagas commit/push ni cambies código/BD. Primero lee
docs/handoffs/10-modular-architecture.md, el diseño aprobado en
docs/superpowers/specs/2026-09-17-modular-architecture-design.md y el código
final. Verifica la estructura existente y la correspondencia de Notion antes
de modificar páginas. Conserva navegación/enlaces y consistencia bilingüe.
No publiques evidencia de una revisión pendiente como si ya hubiera pasado.

Produce las explicaciones completas tanto en español como en inglés, con
lenguaje accesible y términos técnicos entre paréntesis. Usa ejemplos del
código real, no solo del árbol propuesto. Cubre explícitamente los diez puntos:
1. Nombre/definición: monolito modular por funcionalidad (feature-oriented
   modular monolith), una elección contextual y no un estándar obligatorio.
2. Problemas anteriores, razones, alternativas por capas/hexagonal y costes.
3. Árbol final real y función de cada carpeta/archivo importante.
4. Mapa antes/después; API pública estable frente a imports internos eliminados.
5. Dependencias permitidas/prohibidas, ejemplos de imports y qué es un ciclo;
   incluye composición CLI→MCP/TUI/terminal y prohibición app→interfaces.
6. Flujos completos guardar/buscar/sincronizar, conexión compartida,
   transacciones exteriores, replay y CAS.
7. Guía de cambios: regla de memoria, comando, herramienta MCP, consulta SQL,
   pantalla y proveedor futuro de embeddings; no afirmar que ya existe.
8. Grupos de tests, comandos exactos, resultados observados con baseline,
   PostgreSQL real aislado y limitaciones/skips reales. Explica la colocación:
   cada archivo con lógica tiene su propio test hermano; las pruebas conjuntas
   son adicionales en __tests__ de su funcionalidad e importan implementaciones,
   nunca otros tests. Solo las pruebas transversales quedan en tests/.
   Diferencia esta correspondencia del 100% de cobertura; documenta excepciones
   sin lógica y el arranque CLI mínimo, y los recursos de prueba privados.
9. Qué no cambió: datos/formatos, instalación, API pública, comportamiento,
   permisos, privacidad y seguridad; excepción de imports profundos internos.
10. Límites: no elimina errores, no distribuye procesos, no convierte cada
    componente en intercambiable y exige disciplina de imports.

No llamarlo DDD completo, microservicios ni hexagonal estricta. No atribuir al
patrón mayor inteligencia, aprendizaje automático ni mejor calidad de búsqueda.
Señala cualquier diferencia entre handoff, código y evidencia antes de afirmar
resultados. Finaliza con archivos/páginas modificados, enlaces y pendientes.

English delivery requirements: update the matching English documentation and
Notion content with the same ten sections and verified evidence. Explain the
chosen feature-oriented modular monolith, concrete prior problems, reasons,
alternatives and costs; actual tree and ownership; before/after mapping and
stable public API versus removed internal paths; allowed/forbidden imports and
cycles; complete save/search/sync flows and shared transactions; where each
kind of change belongs, including a future embedding provider; test groups,
exact commands and observed results; unchanged data/install/API/behavior/security;
and architectural limits. Explain colocated tests explicitly: every behavior-bearing
implementation has its own sibling test; collaboration suites are additional and
local to the owning feature, never imports of other test suites. Only cross-cutting
checks and shared fixtures remain at the root. Do not equate file pairing with
100% branch coverage. Use plain language with technical terms in parentheses.
Do not claim full DDD, microservices, strict hexagonal architecture, automatic
interchangeability, AI capabilities or measured search improvements. Preserve
cross-language consistency and report modified files/pages and unresolved items.
```
