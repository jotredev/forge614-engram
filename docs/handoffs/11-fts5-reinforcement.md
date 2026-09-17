# Entrega 11 — FTS5 reforzado, sin embeddings

Fecha: 2026-09-17. Rama: `feat/fts5-reinforcement`. Base: `30e0e11`.
Estado: implementación completa, pruebas integrales y revisión independiente aprobadas.
Sin commit, push ni actualizaciones a `docs/es`, `docs/en` o Notion.

## Propósito y comparación honesta

La búsqueda sigue siendo textual y local (SQLite FTS5). Esta entrega añade un
refuerzo pequeño y explicable por revisiones y repeticiones, conserva historial
y permite sincronizar las confirmaciones sin contarlas dos veces.

Referencia inspeccionada: Gentleman-Programming/engram, commit
`2cdda9041c1bff86f6b769171fd407fa677027cb`, en particular
`internal/store/store.go`. La entrega adapta ideas a los contratos de Forge614;
no afirma equivalencia completa con Gentleman ni con todas sus publicaciones.
La ventana de deduplicación y los eventos inmutables son decisiones explícitas
de nuestro diseño. No atribuirles resultados de calidad medidos que no existen.

No hay embeddings, búsqueda semántica, entrenamiento, un segundo modelo de IA,
auditor automático de contradicciones ni probabilidad de verdad. El asistente
de trabajo decide qué guardar mediante `memory_save`; puede omitir guardados.
Los recordatorios e instrucciones no garantizan obediencia ni guardado al cerrar.

## Qué sigue siendo igual

- Una configuración `~/.forge614/.env` y una base `~/.forge614/engram.db`.
- Los proyectos se separan mediante `projectId`, no mediante bases distintas.
- `project` es el alcance predeterminado; `shared` exige intención global explícita.
- Un tema activo del proyecto sustituye al mismo tema compartido en búsquedas
  combinadas. No borra el recuerdo compartido ni lo modifica para otros proyectos.
- SQLite guarda y busca incluso sin conexión. PostgreSQL es una réplica opcional,
  local o remota; no ejecuta la búsqueda FTS5 ni reemplaza SQLite.
- Consultar, buscar, exportar e importar no crea confirmaciones.
- Las vistas breves conservan 300 puntos de código Unicode; contexto conserva
  sus límites existentes. La búsqueda de términos cortos mantiene su ruta literal.
- Se conserva el control de versiones esperado y los conflictos explícitos.

## Qué significa guardar otra vez

Un recuerdo nuevo comienza en versión 1, con cero revisiones y cero confirmaciones.
Si cambia el contenido de un tema, se crea una versión nueva. Si se vuelve a
guardar exactamente el mismo título, contenido, tipo, tema y estado de fijado,
puede registrarse una confirmación sin fabricar otra versión.

La igualdad usa los valores normalizados por la validación existente. No busca
sinónimos, no aproxima frases y no compara significados con IA.

Con tema (`topicKey`), la coincidencia se resuelve dentro del mismo propietario;
se exige `expectedVersion` vigente incluso cuando el texto es idéntico.
Sin tema, el candidato debe estar activo, pertenecer al mismo alcance y proyecto,
y haber sido observado entre ahora menos 900000 milisegundos y ahora, ambos
extremos incluidos. Es decir, una ventana móvil de 15 minutos desde creación,
actualización o última confirmación. Fechas futuras quedan fuera de esa selección.
Fuera de la ventana se crea otro recuerdo. Entre varios candidatos se elige el
más recientemente observado y, si empatan, el menor ID. No se fusionan ni borran
otros recuerdos antiguos.

Archivar no permite confirmar ni restaurar implícitamente un tema archivado.
Una confirmación con reloj anterior a la versión que pretende confirmar falla
con `CLOCK_SKEW`; no se inventa una fecha para hacerla pasar.

Una confirmación significa «se volvió a guardar la misma información», no
«una persona verificó que es verdadera». Las revisiones anteriores también
influyen débilmente en estabilidad; no prueban la validez de la versión actual.

### Reintentos y sesiones

`requestKey` identifica una operación lógica. Repetir la misma clave y carga
devuelve la respuesta conservada sin añadir otra confirmación. Usarla con una
carga incompatible produce `REQUEST_CONFLICT`. La unicidad se comprueba entre
peticiones históricas y nuevas peticiones de confirmación del mismo propietario.

El asistente debe conservar la clave al reintentar y usar una nueva para una
observación independiente. Sin clave no es posible distinguir una repetición
real de un reintento de red; no prometer deduplicación de red automática.

La confirmación puede asociarse a una sesión sin mover la entrada histórica del
recuerdo ni inventar una versión. Se conservan validaciones de propiedad y sesión.
El timeline mantiene su contrato actual: esta entrega no añade una lista de
confirmaciones a sus entradas.

## Puntuación explicada

La coincidencia textual (BM25) conserva los pesos: título 5, contenido 1, tema 3.
SQLite devuelve BM25 negativo; menor valor significa mejor posición. No es una
calificación entre cero y uno.

```text
revisionCount = versión actual - 1
duplicateCount = número de confirmaciones distintas
lastSeenAt = máximo entre updatedAt y fechas de confirmación
ageDays = max(0, (ahora - lastSeenAt) / 86400000)
n = revisionCount + duplicateCount

multiplier = 1 + 0.10 * fijado
               + 0.06 / (1 + ageDays / 30)
               + 0.04 * n / (n + 4)
orderScore = BM25 * multiplier
```

Un recuerdo fijado, observado hoy, con dos revisiones y dos confirmaciones tiene
un multiplicador de `1 + 0.10 + 0.06 + 0.02 = 1.18`. Si BM25 es `-2`, la puntuación
final es `-2.36`. Con igual coincidencia, un recuerdo sin fijar ni refuerzos,
observado hoy, obtiene `-2 * 1.06 = -2.12`; aparece después. A los 30 días, el
primer multiplicador es `1.15`. La estabilidad se acerca a 0.04 sin crecer sin
límite. Una coincidencia textual más fuerte puede seguir ganando.

Todos los candidatos de una consulta usan el mismo instante, con precisión de
milisegundos. SQL calcula el orden antes de aplicar el límite de resultados y
desempata por ID ascendente. Las vistas completas y breves comparten consulta.
La explicación devuelve BM25, multiplicador, puntuación y los factores opcionales
`reinforcement`: `revisionCount`, `duplicateCount`, `lastSeenAt`, `ageDays`,
`pinnedBoost`, `recencyBoost`, `stabilityBoost`.

Las bases antiguas mantienen la fórmula previa hasta habilitar el refuerzo.
La búsqueda literal mantiene `bm25: null`, `orderScore: null`, multiplicador 1
y el orden previo; no se inventa una explicación FTS5 para ella. Los factores
no se insertan en las versiones históricas de los recuerdos.

## Compatibilidad y almacenamiento

Activación local desde el ejecutable instalado:

```sh
forge614-engram reinforcement-enable
```

Devuelve JSON `{"enabled":true,"schema":7}`. Repetirlo es seguro; si existe una
configuración cuya base desapareció, falla y no la sustituye por una vacía.
También se ofrece en `forge614-engram setup`, con «No» por defecto y cambios solo
después de la confirmación final. Si ya está activo, informa su estado y no
ofrece una deshabilitación ficticia. No se elige proyecto para habilitarlo.

Para una réplica PostgreSQL ya configurada, después de actualizar todos los
equipos y habilitar la capacidad local correspondiente:

```sh
forge614-engram sync --upgrade-format
```

La habilitación local no publica ni promueve la réplica. `sync` sin la opción
rechaza una promoción necesaria con `SYNC_UPGRADE_REQUIRED`; recibir formato 3
en un cliente sin refuerzo habilitado falla con `REINFORCEMENT_REQUIRED`.
La opción existente promueve al formato del paquete local, no siempre a 3: con
sesiones y sin refuerzo puede ser formato 2. No confundir habilitar capacidad
con sincronizar datos. `sync-watch` no promueve formatos y rechaza
`--upgrade-format`; la promoción se hace con el comando puntual `sync`.

La habilitación explícita añade las tablas `confirmations` y
`confirmation_requests`, sus índices y el esquema SQLite 7. Encadena las
habilitaciones existentes de esquemas 3–6 sin configurar PostgreSQL ni asistentes.
Abrir una base antigua no la migra. La operación valida el esquema esperado y es
transaccional: `IF NOT EXISTS` no autoriza aceptar una tabla incompatible.
Los recuerdos antiguos empiezan con cero confirmaciones, sin fabricar historial.
No se promete un comando de deshabilitación o downgrade.

Cada evento tiene un UUID propio (`confirmationId`), recuerdo, versión, fecha y
sesión opcional. Las peticiones guardan su clave, hash y respuesta estable aparte.
La propiedad procede del recuerdo, no de texto libre recibido por sincronización.

El paquete de sincronización pasa al formato 3; añade colecciones de eventos y
peticiones sin reescribir los bloques históricos. Los lectores nuevos admiten
formatos 1/2 y no inventan eventos. Los lectores antiguos rechazan el formato 3;
actualizar todos los equipos antes de promover la réplica. El esquema físico de
PostgreSQL y su `state.format = 1` no cambian: formato del paquete y formato de
tablas remotas son cosas distintas.

La unión se hace por identidad de evento, nunca sumando contadores importados.
El mismo evento cuenta una vez; dos confirmaciones independientes se conservan.
El mismo ID con datos distintos, una clave reutilizada con respuesta incompatible
o contenido editado concurrentemente producen conflicto, no un ganador silencioso.
Se conservan validaciones de propietario/sesión, publicación condicional y
aplicación local transaccional. Los vínculos de directorios siguen siendo locales.

El límite de cada snapshot sigue siendo 8 MiB. No hay poda automática para saltarlo;
las confirmaciones hacen crecer los datos. No hay servidor cloud propio, servicio
permanente instalado ni transmisión causada por una búsqueda local.

## Arquitectura y pruebas

Se mantiene el **monolito modular por funcionalidad** (feature-oriented modular
monolith): un programa, con responsabilidades delimitadas. Las reglas puras de
confirmación y puntuación están en `modules/memory`; SQLite contiene persistencia
y consulta; `modules/synchronization` valida y fusiona; `app` coordina; CLI y MCP
son interfaces. Esto evita mezclar reglas, SQL y transporte sin introducir
microservicios, repositorios genéricos ni una capa de abstracción por operación.

Cada archivo con lógica tiene su prueba hermana. Las colaboraciones se prueban
adicionalmente en `__tests__` del componente; sus recursos privados viven en
`__test-support__`. Una suite no importa otra suite. Tener estos pares no equivale
a cobertura del 100% de ramas. Véase también la Entrega 10 para decisiones,
alternativas, costes y reglas de dependencias del patrón.

Verificación integral ejecutada por el controlador con Bun 1.3.8, TypeScript
5.9.3 y PostgreSQL 17.6 desechable:

```sh
FORGE614_TEST_POSTGRES_BIN=/tmp/engram-postgres-17.6.tTVxxc/postgres/bin bun test
bun run typecheck
git diff --check
```

Resultado: **439 pruebas aprobadas, 0 fallos, 2274 aserciones, 76 archivos,
38.62 segundos**, sin pruebas omitidas. Incluye instalación compilada, MCP,
terminal real (PTY), arquitectura y PostgreSQL real. Tipado y revisión de espacios:
código de salida 0. La ruta de binarios es temporal: si desaparece, preparar
otros binarios de prueba explícitos, nunca reutilizar `DATABASE_URL` ni servicios
del usuario. Sin esa variable se omiten casos PostgreSQL; no presentar esa
ejecución como verificación integral equivalente.

La revisión global independiente de especificación y calidad terminó aprobada,
sin hallazgos críticos, importantes ni menores. Las cinco revisiones por tarea
también quedaron aprobadas; las correcciones de validación de sesiones y de
cobertura de propiedad se comprobaron mediante revisiones acotadas. No se realizó
commit, staging, push, PR ni modificación de documentación bilingüe o Notion.

Decisiones operativas registradas: se trabajó en una rama nueva dentro del mismo
directorio, sin crear otro worktree; se conservó la evidencia temporal porque
no hay commits de esta entrega; se fijó el borde inclusivo de 15 minutos y se
excluyeron candidatos con fecha futura. Las dos primeras mantienen el flujo del
usuario (a costa de no tener aislamiento físico ni limpieza de scratch); la
última es una política propia que puede requerir revisión si cambia el producto.

## Prompt de documentación

```text
Actualiza la documentación de la Entrega 11 de Forge614 Engram, por separado en
docs/es y docs/en, y sus páginas correspondientes de Notion. Primero lee
docs/handoffs/11-fts5-reinforcement.md, el diseño y plan 2026-09-17-fts5-reinforcement
de docs/superpowers y el código final. Contrasta las afirmaciones con ese código.
No cambies producto, pruebas, bases, configuración ni credenciales. No hagas
commit, push, PR ni habilites capacidades. No marques como aprobada una revisión
que este handoff indique pendiente. Comprueba acceso y correspondencia de páginas
Notion antes de modificar; si falta acceso, reporta el pendiente sin fingir sync.

La documentación debe ser exhaustiva, accesible para alguien sin experiencia:
explicación cotidiana primero y término técnico entre paréntesis. Inglés y español
deben tener igual contenido y ejemplos, con carpetas y navegación separadas.
Actualiza también índices, instalación, recorrido, CLI, SDK, arquitectura/fórmula,
errores, glosario, límites y roadmap cuando corresponda. Conserva enlaces y
jerarquía de Notion. Usa ejemplos con UUID/valores ficticios, nunca datos reales.

Cubre todos estos puntos:
1. Qué implementamos y qué no: FTS5 local reforzado, sin embeddings, entrenamiento,
   modelo extra ni verificación automática de verdad. La captura depende del
   asistente de trabajo y sus permisos; no se garantiza cada guardado o cierre.
2. Una .env y engram.db globales, projectId por proyecto, shared solo explícito,
   sustitución por tema y SQLite local incluso con PostgreSQL opcional.
3. Diferencia entre creación, revisión, confirmación, reintento y verdad. La
   igualdad exacta normalizada; tema y expectedVersion; sin tema, ventana móvil
   inclusiva de 15 minutos, descarte de candidatos futuros y desempate por ID.
   Archivados no se restauran solos; fuera de ventana puede haber otro recuerdo.
4. requestKey estable por operación, nueva para observaciones independientes;
   replay sin contar otra vez, conflicto si cambia carga y limitación sin clave.
   Sesiones asociadas sin mover entradas históricas; timeline no gana eventos.
5. Fórmula completa, pesos 5/1/3, BM25 negativo y orden ascendente, factores
   0.10/0.06/0.04, escala 30 días y saturación n/(n+4). Explica cada variable y
   el ejemplo 1.18, -2.36 frente a -2.12; a 30 días 1.15. No es probabilidad.
   Un instante por consulta, orden antes de LIMIT, ID para empate, proyecciones
   breves/completas, términos cortos literales y explicación optional reinforcement.
6. Guía paso a paso real: instalación existente desde repo, init/setup según
   situación, reinforcement-enable, crear proyecto/guardar/buscar con JSON de
   ejemplos verificado, reintentar misma clave, confirmar con clave nueva y ver
   historia sin versión redundante. En SDK mostrar enableSearchReinforcement()
   y reinforcementEnabled() sin recomendar una base por proyecto.
7. Setup: oferta si/NO antes de confirmación final; cancelar no habilita;
   ya habilitado no ofrece downgrade. El comando es repetible, rechaza base
   configurada ausente y no recrea los datos perdidos. No configura asistentes
   automáticamente. Las instrucciones nuevas para asistentes ya configurados
   requieren el mecanismo existente de actualización con vista previa en TUI;
   no afirmar que se reescribieron archivos del usuario durante esta entrega.
8. Migración aditiva explícita desde SQLite 3–6 a 7, validación exacta y rollback;
   sin eventos sintéticos ni reescritura de historial/checkpoints. No hay downgrade
   prometido. Diferenciar esquema SQLite7, payload3 y state.format1 de PostgreSQL.
9. Actualizar todos los equipos, habilitar capacidad local y promover por separado
   con sync --upgrade-format. La opción promueve al formato habilitado, no siempre3;
   sync-watch rechaza esa opción. Lectores nuevos admiten1/2; antiguos rechazan3.
   Errores REINFORCEMENT_REQUIRED/SYNC_UPGRADE_REQUIRED y CLOCK_SKEW con acciones
   seguras, sin aconsejar borrar bases, reintentar con claves nuevas a ciegas ni
   esconder conflictos. No existe servidor cloud propio en esta entrega.
10. Fusión por UUID de confirmación, mismo evento una vez, eventos independientes
    conservados, conflictos de identidad/peticiones/contenido, validación de
    propietario/sesión, pérdida de acuse y funcionamiento offline. Límite 8MiB,
    crecimiento por eventos y ausencia de poda automática.
11. Patrón: monolito modular por funcionalidad; qué significa, por qué se eligió,
    problemas que resuelve, alternativas por capas/hexagonal y sus costes.
    Muestra archivos reales y flujos guardar/buscar/sincronizar. No lo llames
    microservicios, DDD completo ni arquitectura hexagonal estricta. Explica
    tests hermanos por archivo con lógica y suites adicionales __tests__ para
    colaboraciones, helpers privados y ninguna importación entre suites.
    No equiparar organización de pruebas con 100% de cobertura de ramas.
12. Comandos y resultados exactos de verificación, revisiones y límites conocidos.
    Distingue cambios implementados de ideas futuras y evidencia de mejoras
    de orden de cualquier mejora de calidad no medida. Cita Gentleman por el
    commit inspeccionado y no prometas paridad total con versiones desconocidas.

English requirements: deliver matching complete English documentation and Notion
pages for all twelve items, using plain-language explanations followed by technical
terms in parentheses. Preserve identical semantics, examples, safety warnings,
compatibility rules, formulas and verified evidence across both languages.

Termina con archivos/páginas cambiados, enlaces, validaciones realizadas y
pendientes. Señala discrepancias entre código y handoff antes de documentarlas.
```
