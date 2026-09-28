# Entrega 10 — Organización modular del proyecto

Estado: diseño aprobado por el usuario; implementación autorizada.
Adenda aprobada posterior: se sustituye la ubicación global por tipo de pruebas descrita en el árbol original por pruebas colocadas junto a cada archivo con lógica (`<nombre>.test.ts`). Las pruebas de colaboración son adicionales en `__tests__` de su funcionalidad; solo arquitectura, instalación/flujos transversales y fixtures compartidos permanecen en `tests/`. Tipos, datos estáticos, reexportaciones y el arranque CLI mínimo no exigen pruebas artificiales. Las suites no importan otras suites; producción no importa código de pruebas. Esta adenda prevalece sobre las ubicaciones históricas de las secciones 3 y 8; no cambia las capas ni el comportamiento del producto. El árbol real actualizado y la explicación detallada están en el handoff de la entrega.
Base inspeccionada: main, e28ca32, programa 0.5.0.
Rama prevista para implementar: refactor/modular-architecture.
No se autoriza commit ni push automático.

## 1. Objetivo y alcance

Reorganizar Forge614 Engram mediante un **monolito modular organizado por
funcionalidad, con separación entre lógica e infraestructura**. Monolito significa
que sigue siendo un programa desplegable, no varios servicios. Modular significa
que cada responsabilidad tiene un dueño y una entrada definida.

Esta entrega mejora la estructura, no incorpora búsqueda semántica. No cambia
formatos de datos, comandos, resultados, puntuación, permisos, reglas de sesión
ni comportamiento de sincronización. Primero se estabiliza esta organización;
la siguiente entrega de búsqueda se diseña después.

Problemas observados: aproximadamente 3154 líneas de código de producto, con
almacenamiento, sesiones, búsqueda, configuración, terminal y MCP mezclados en
la raíz de src. MemoryStore reúne SQL, proyectos, versiones, sesiones y réplica.
La TUI resuelve ejecutables y configura asistentes; varias pruebas dependen de
rutas relativas que cambiarían al reorganizarlas.

No basta con mover archivos: se separarán responsabilidades preservando los
límites de las transacciones y se comprobarán las dependencias automáticamente.

## 2. Elección del patrón y alternativas

### Elegido: monolito modular por funcionalidad

Agrupa conceptos del producto (memoria, proyectos, sesiones, búsqueda, réplica,
espacio global e integraciones). Las interfaces presentan esos conceptos al
usuario/asistente y los adaptadores realizan SQL, archivos y llamadas Git.
Permite localizar dónde cambiar una regla sin conocer toda la aplicación.

Es adecuado para un CLI local con una base y un SDK compartidos. No requiere
servidores, paquetes separados ni comunicación de red entre módulos. Permite
añadir otro motor de recuperación sin mezclarlo con comandos o permisos de disco.

Coste: hay que mantener las entradas públicas, clasificar correctamente las
funciones y respetar dependencias. Las carpetas por sí solas no garantizan eso.

### Alternativa: carpetas globales por capas

Separaría todos los modelos, servicios y repositorios, pero una funcionalidad
quedaría distribuida por varias carpetas globales. Se conserva su principio de
separación, sin usarlo como única organización del producto.

### Alternativa: arquitectura hexagonal estricta

Usaría interfaces y adaptadores para casi todas las interacciones. Aporta
sustituibilidad, pero introducir un repositorio genérico, un contenedor de
inyección y abstracciones para cada consulta sería excesivo para este alcance.
Solo habrá contratos de dependencia donde separen una operación externa real;
no una interfaz nueva por cada clase ni implementaciones ficticias de producción.

No se denominará a esta entrega DDD completo, microservicios ni arquitectura
hexagonal estricta. Se toman límites útiles, no todas sus prácticas.

## 3. Estructura y responsabilidades

```text
src/
  cli.ts                         # Entrada estable del ejecutable
  index.ts                       # Exportaciones públicas estables del SDK
  app/
    index.ts                     # Entrada de los flujos de aplicación
    memory-store.ts              # Fachada compatible con MemoryStore actual
    workspace.ts                 # Apertura/cierre y coordinación del espacio
    project-context.ts           # Coordina identidad Git y vínculos guardados
    synchronization.ts           # Coordina réplica y recursos, no imprime
    setup.ts                     # Secuencia de configuración, conserva SetupIO
    assistants.ts                # Coordina detección/configuración/autoprueba
  modules/
    memory/                      # Tipos, validación y reglas de recuerdos
    projects/                    # Identidad y reglas de proyectos
    sessions/                    # Tipos, IDs, resúmenes y política de selección
    search/                      # Tipos, términos, límites y ordenación
    synchronization/             # Snapshots, validación y reconciliación
    workspace/                   # Contratos de configuración global
    assistants/                  # Catálogo, protocolo y reglas de integración
  infrastructure/
    sqlite/                      # Conexión, esquema y operaciones por función
    postgres/                    # Transporte de snapshots y validación remota
    filesystem/                  # Rutas, permisos y publicación segura
    git/                         # Resolución acotada de repositorios/worktrees
    assistants/                  # Archivos de clientes y autoprueba de procesos
  interfaces/
    cli/                         # Argumentos, ayuda, comandos y salida JSON
    mcp/                         # Servidor, catálogo, esquemas y herramientas
    tui/                         # Estado de pantalla, render y teclado
    terminal/                    # Preguntas de setup, señales y salida de watch
  shared/
    errors.ts                    # MemoryError compartido, una sola clase

tests/
  architecture/                  # Reglas de imports y ausencia de ciclos
  unit/                          # Lógica sin bases ni procesos reales
  integration/                   # SQLite/PostgreSQL/archivos/componentes
  e2e/                           # CLI, MCP, instalación y terminal reales
  fixtures/                      # Entornos temporales y ayudas de pruebas

scripts/
  install.sh                     # Conserva compilación desde src/cli.ts
```

El árbol muestra destinos, no obliga a crear carpetas vacías. Dentro de un módulo
se usarán archivos descriptivos como types.ts, validation.ts o policy.ts cuando
haya contenido real. No repetir domain/application/infrastructure en siete
módulos por estética. Cada módulo tendrá index.ts para su contrato, con
exportaciones explícitas; no exponer todas sus funciones internas por comodidad.

shared no será una carpeta de utilidades generales: inicialmente contiene
únicamente la clase de error que ya comparten varios subsistemas. Otros tipos
pertenecen al módulo que define su significado.

## 4. Dependencias permitidas

1. Los módulos contienen tipos y reglas; no importan app, interfaces,
   infrastructure, bun:sqlite, sockets, fs ni ejecución de procesos.
2. Los adaptadores de infrastructure pueden importar las entradas públicas de
   los módulos y shared. No importan app ni interfaces.
3. app conecta módulos y adaptadores. No importa interfaces ni imprime resultados
   de CLI/MCP. El contrato SetupIO existente se conserva, sin mover entrada de
   terminal real a app.
4. interfaces usa la entrada de app y contratos públicos de módulos/shared.
   No ejecuta consultas SQL ni escribe directamente configuración. Sí contiene
   los SDK de transporte, validación de entrada y operaciones propias de terminal.
5. src/cli.ts conecta el punto de entrada CLI; src/index.ts publica el SDK.
   El código interno nunca importa src/index.ts: evita dependencias circulares
   desde el punto de exportación hacia sus propios componentes.
6. Fuera de un módulo, se importa su index.ts; dentro del módulo se permiten
   imports relativos directos. Los adaptadores SQLite pueden colaborar por sus
   archivos internos en una misma transacción, no mediante el SDK público.

Dependencias de conceptos permitidas: memory puede usar tipos de projects;
sessions puede usar memory/projects; search puede usar memory/sessions/projects;
synchronization puede usar memory/sessions/projects. projects no depende de
memory; ninguno depende de synchronization para guardar localmente. workspace
y assistants no introducirán dependencias de retorno a esos módulos.

Se permitirán primitivas sin efectos externos como hashing, UUID y tipos estándar
cuando ya sean necesarias. Separación de infraestructura no significa prohibir
todo import de node:crypto; significa no acoplar reglas a bases, disco o procesos.

Habrá una prueba de arquitectura con el analizador de TypeScript ya disponible,
sin instalar un framework nuevo: resolverá imports, reexports e imports dinámicos
literales, comprobará límites y ciclos entre componentes. Las dependencias de
tipos también cuentan para impedir filtración de detalles. Excepciones deben
ser concretas, justificadas y probadas; no comodines que anulen las reglas.

## 5. Destino del código existente

| Origen | Destino y separación |
| --- | --- |
| domain.ts | Tipos en módulos memory/projects; MemoryError en shared |
| identity.ts | modules/projects, conservando validación UUID |
| session-types.ts y sessions.ts | Tipos/políticas en modules/sessions; SQL en infrastructure/sqlite/sessions |
| retrieval-types.ts y retrieval.ts | Contratos/términos/límites en modules/search; consultas y proyecciones en infrastructure/sqlite/search |
| store.ts | Fachada app/memory-store y operaciones SQLite separadas por proyectos, memoria, sesiones y búsqueda |
| schema.ts | infrastructure/sqlite/schema; DDL y validación exacta sin cambios |
| sync-snapshot.ts | modules/synchronization, lógica de formatos y reconciliación |
| sync-local.ts | infrastructure/sqlite/snapshots |
| sync-postgres.ts | infrastructure/postgres/replica |
| synchronize.ts y sync-runner.ts | app/synchronization; espera/señales/impresión de watch en interfaces/terminal |
| paths.ts, workspace-config.ts, workspace-database.ts | infrastructure/filesystem y conexión segura SQLite; WorkspaceConfig sigue exportado |
| workspace.ts | app/workspace, manteniendo su contrato |
| project-context.ts | app/project-context más infrastructure/git; validaciones de identidad en projects |
| setup.ts y setup-terminal.ts | app/setup e interfaces/terminal/setup |
| cli.ts | Entrada mínima más interfaces/cli, parser/ayuda/despacho por familias |
| mcp.ts y mcp-tools.ts | interfaces/mcp, separar servidor/esquemas/handlers por familias |
| memory-protocol.ts | modules/assistants/protocol |
| assistants/catalog.ts | Metadatos/reglas en modules/assistants; detección de archivos/ejecutables en infrastructure |
| assistants/configuration.ts y files.ts | Adaptadores de archivos en infrastructure/assistants y filesystem; coordinación en app |
| assistants/hooks.ts | Plantillas/protocolo en módulo; entrada/salida del comando hook en interfaces |
| assistant-self-test.ts | infrastructure/assistants, proceso acotado de prueba del propio servidor |
| assistant-tui.ts y assistant-tui-render.ts | interfaces/tui; resolver ejecutable/datos mediante app |

No mantener copias de la implementación antigua y nueva. Solo se conservan como
rutas públicas src/index.ts y src/cli.ts. Los imports internos y de pruebas se
actualizan; rutas profundas anteriores de src no se convierten en una API pública
permanente. Si alguien las usaba directamente necesitará actualizar sus imports;
esta limitación debe aparecer en el handoff.

MemoryStore no se transforma en una nueva API asíncrona ni cambia constructor o
retornos. Será una fachada (entrada compatible que delega) sobre operaciones
concretas. No debe trasladarse intacto el archivo grande y llamarlo modular.

## 6. Transacciones, datos y errores: invariantes

El recurso SQLite es privado de los adaptadores; no aparece en exportaciones del
SDK ni en contratos de lógica de negocio. Una conexión por instancia mantiene
su ciclo de vida actual. No añadir conexiones por módulo.

Guardar proyecto/vínculo/recuerdo/versión/evento/solicitud/entrada de sesión sigue
siendo una operación atómica. El adaptador coordinador de escritura controla la
transacción exterior; sus helpers participan en esa misma conexión sin confirmar
por separado. El resumen y su puntero siguen dentro de esa operación.

Se conserva exactamente:

- Orden de validación/replay y errores observables; replay no escribe ni cambia
  el origen de sesión o el puntero al resumen vigente.
- Hash de solicitudes y serialización canónica de snapshots.
- Versiones SQLite 3/4/5/6 y snapshots 1/2, application_id y DDL actual.
- Migraciones y promoción de formato explícitas, sin una migración nueva.
- projectId/shared, sustitución por tema, aislamiento y privacidad del origen.
- Puntuación FTS, orden literal, límites Unicode/bytes y lecturas históricas.
- Comparación remota CAS, archivos locales excluidos de réplica y rollback.
- Un único directorio global, .env y engram.db; permisos y protección contra
  enlaces simbólicos; sin recrear silenciosamente una base configurada ausente.
- Una sola identidad de la clase MemoryError para conservar instanceof.
- Apertura diferida del MCP y ausencia de escrituras en initialize/listTools.

No traducir ni renombrar errores como parte de esta reorganización. No aprovechar
el movimiento para corregir fórmulas, introducir normalización adicional o cambiar
las decisiones de privacidad: cualquier cambio funcional requiere otra entrega.

## 7. Ejemplos de flujo para entender la separación

### Guardar desde MCP

La herramienta valida el mensaje y pide el guardado a app. La coordinación
resuelve el proyecto mediante Git y vínculos locales. Las reglas validan el
recuerdo y la selección de sesión. El adaptador SQLite realiza la escritura
atómica. MCP presenta el resultado sin consultar ni escribir tablas por su cuenta.
El CLI utiliza el mismo guardado, con la política independiente ya existente.

### Buscar

CLI o MCP valida sus parámetros. app delega en la recuperación local. El módulo
search define términos, límites y contratos; SQLite ejecuta FTS/proyección. MCP
entrega vistas previas, mientras CLI conserva su salida completa por defecto.
La organización deja un lugar para futuros embeddings, pero no los implementa.

### Sincronizar

app obtiene snapshots mediante adaptadores local/remoto. El módulo de réplica
valida y reconcilia valores sin conectarse a PostgreSQL. La coordinación verifica
capacidades/promoción, publica con CAS y aplica localmente. La terminal muestra
el resultado; las escrituras locales no dependen del proceso de sincronización.

## 8. Pruebas y migración del código

La implementación se dividirá en bloques revisables: contratos y pruebas de
límites, persistencia/fachada, coordinación/adaptadores externos, interfaces y
verificación de distribución. Cada bloque debe compilar y tener pruebas antes
del siguiente. No mezclar búsqueda semántica con los movimientos.

Las pruebas se clasifican por comportamiento, no por nombre actual. Las que abren
SQLite real pertenecen a integration, aunque estén en memoria; pruebas del
ejecutable, MCP por stdio e interacción PTY pertenecen a e2e. Un archivo mixto
se puede separar conservando todos sus casos y limpieza de recursos.

Al moverlas hay que actualizar import.meta.dir, rutas a fixtures, preloads,
subprocesos y compilación. tests/fixtures/snapshot-v1 conserva su lógica histórica;
solo se actualizan imports, manteniendo la atribución del commit original.

Verificación requerida antes de declarar terminada la reorganización:

- Inventario de exportaciones de src/index.ts y métodos públicos de MemoryStore,
  comparado con el estado inicial: mismos tipos, firmas y comportamiento.
- Pruebas de imports/ciclos que fallen ante dependencias prohibidas y pasen con
  el árbol final; no pruebas basadas únicamente en nombres de carpetas.
- Pruebas existentes conservadas más regresiones para cualquier extracción que
  modifique límites de recursos o transacción. No reducir cobertura para lograr verde.
- Suite completa, typecheck, revisión de cambios y ejecutable compilado instalado
  en un usuario temporal: CLI/MCP/sesiones, hooks y terminal.
- PostgreSQL desechable real para sincronización/promoción; nunca URL del usuario.
- Baseline y resultado final registrados con cifras observadas; el conteo puede
  variar por separación o nuevos casos y no sustituye comprobar qué se prueba.
- Sin cambio en contenidos de base, formato de configuración o contenido generado
  de plugins debido únicamente a rutas internas del código.

## 9. Documentación y entrega al otro modelo

El usuario actualizará docs/es, docs/en y Notion con otro modelo. No editar esas
superficies ni sincronizar Notion desde esta entrega. Entregar
docs/handoffs/10-modular-architecture.md con inventario real de movimientos,
evidencias, límites y un prompt listo para copiar.

Ese prompt debe exigir, en ambos idiomas y con términos técnicos entre paréntesis:

1. Nombre y definición del patrón, sin venderlo como un estándar obligatorio.
2. Problemas concretos anteriores, razones de elección, alternativas y costes.
3. Árbol final real y explicación de cada carpeta/archivo importante.
4. Mapa antes/después y ubicación de API pública frente a detalles internos.
5. Dependencias permitidas/prohibidas con ejemplos de imports y explicación de ciclos.
6. Recorridos completos de guardar/buscar/sincronizar y transacciones compartidas.
7. Guía «dónde poner un cambio»: nueva regla de memoria, comando, herramienta MCP,
   consulta SQL, pantalla y futuro proveedor de embeddings.
8. Organización de pruebas, comandos exactos y evidencias reales de verificación.
9. Qué NO cambió: datos, instalación, API pública, comportamiento y seguridad.
10. Límites del patrón: no elimina errores, no distribuye procesos, no hace
    intercambiable cada componente automáticamente y exige disciplina de imports.

No prometer que una carpeta o un patrón consigue por sí solo más inteligencia,
aprendizaje automático o calidad de búsqueda. Explicar ejemplos reales del código
final, no únicamente el árbol propuesto en este diseño.

## 10. Autorrevisión y siguiente paso

El diseño conserva entradas públicas y formatos; asigna dueño a cada responsabilidad,
explicita la transacción y separa dominio de acceso externo. Incluye cómo verificar
límites y adaptar pruebas que dependen de rutas. La única compatibilidad excluida
es el import directo de antiguos archivos internos, señalado en la sección 5.

El usuario aprobó continuar directamente con los cambios. Se elaborará el plan
de implementación y se ejecutará con subagentes y revisión por bloques.
Este documento no significa que los archivos ya se hayan reorganizado.
