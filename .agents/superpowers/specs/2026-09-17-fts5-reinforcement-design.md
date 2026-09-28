# FTS5 reforzado: guardado, puntuación y sincronización

Estado: diseño aprobado e implementado; verificación integral y revisión independiente aprobadas.
Fecha: 2026-09-17.
Inspección inicial: cae37eb, rama refactor/modular-architecture. Se verificó su
integración en origin/main 30e0e11 y se creó feat/fts5-reinforcement desde esa base.
Entrega sin commit ni push; evidencia y prompt en docs/handoffs/11-fts5-reinforcement.md.

## Objetivo y límites

Completar la búsqueda textual local inspirada en Gentleman Engram, sin embeddings,
sin modelos adicionales y sin revisión de contradicciones con IA. Una sola
`~/.forge614/engram.db`, un `.env`, projectId estable y shared únicamente explícito.
No cambiar las reglas de sustitución por tema, visibilidad ni propiedad.

Referencia inspeccionada: Gentleman-Programming/engram, main
2cdda9041c1bff86f6b769171fd407fa677027cb. No afirmar equivalencia con todas sus
versiones publicadas. Pesos y fórmula verificados en `internal/store/store.go`.
Esta entrega adapta la gestión de confirmaciones a nuestro historial y protocolo
de sincronización; no copia automáticamente el modelo de datos de Gentleman.

## Situación actual

`src/infrastructure/sqlite/search.ts` ya utiliza BM25 con pesos 5/1/3,
prioridad de fijado 0.10 y actualidad 0.06 con escala de 30 días.
Las proyecciones completas y breves comparten consulta. Ya existen recuperación
progresiva, sesiones, timeline y contexto con límite de bytes.

`writes.ts` conserva versiones y peticiones idempotentes. Repetir requestKey
devuelve el resultado anterior sin escritura. Actualizar un tema exige
expectedVersion y crea una versión. No hay un contador de confirmaciones.

La sincronización usa snapshots estrictamente validados, historial inmutable,
comparación de tres estados y conflictos explícitos; PostgreSQL almacena snapshots,
no una segunda base de búsqueda. No debilitar estas garantías.

## Opciones consideradas

1. Usar únicamente `version - 1` como estabilidad: barato, pero no diferencia
   correcciones de confirmaciones y no reconoce duplicados sin tema. Insuficiente.
2. Añadir contadores mutables: simple en un equipo; al fusionar equipos, sumar
   duplica confirmaciones o tomar el máximo pierde confirmaciones independientes.
3. Registrar confirmaciones inmutables con identidad propia y derivar sus
   métricas: recomendado. Permite unión sin duplicados y auditar su procedencia.

## Guardado y confirmación

Una confirmación significa que el asistente volvió a guardar la misma información;
no demuestra que sea verdadera ni que una persona la haya verificado.

- Crear un recuerdo conserva el comportamiento actual: versión inicial 1.
- Cambiar contenido, título, tipo o fijado mediante un tema conserva el control
  de versión y crea una nueva versión. No convertir cambios en confirmaciones.
- Guardar exactamente el mismo título, contenido, tipo, tema y fijado de un
  recuerdo activo registra una confirmación, sin crear una versión redundante.
- Con tema, resolver por propietario y tema, conservando expectedVersion incluso
  cuando el contenido coincida. No aceptar una expectativa obsoleta.
- Sin tema, buscar coincidencia exacta del contenido normalizado por las reglas
  existentes de entrada, dentro del mismo propietario y alcance, durante los
  últimos 15 minutos desde su creación, actualización o confirmación más reciente.
  Fuera de esa ventana crear otro recuerdo. No aplicar coincidencia semántica.
- Si hay varios duplicados antiguos, elegir el más recientemente observado;
  desempatar por ID ascendente. No fusionar ni borrar los otros recuerdos.
- Un recuerdo archivado no es candidato a deduplicación; mantener el error actual
  para un tema archivado. No restaurarlo implícitamente.
- Una lectura, búsqueda, exportación o importación no genera confirmaciones.
- Repetir la misma requestKey y carga devuelve la misma respuesta sin otro evento;
  reutilizar esa clave con otra carga sigue produciendo conflicto.
- Sin requestKey no se puede distinguir una nueva petición de un reintento de red.
  Documentar esa limitación y recomendar claves estables en las instrucciones MCP.

Cada confirmación incluye confirmationId UUID, memoryId, versión confirmada y
recordedAt UTC. El propietario se obtiene del recuerdo; nunca se infiere de texto.
La carga confirmada debe coincidir con la versión referenciada. Las peticiones de
confirmación guardan separadamente su clave, hash de entrada y respuesta estable;
no reinterpretar ni reescribir la tabla histórica de peticiones de guardado.
La unicidad de requestKey se valida conjuntamente entre ambos tipos de petición.

Las confirmaciones pueden asociarse a una sesión mediante un registro separado:
no cambiar la propiedad de una entrada histórica `(memoryId, version)` ni simular
una nueva versión para que aparezca en otra conversación. Timeline conserva sus
entradas actuales; las confirmaciones no amplían su contrato en esta entrega.

## Métricas y fórmula

revisionCount = número de actualizaciones versionadas, excluyendo la creación.
duplicateCount = número de confirmationId distintos registrados.
lastSeenAt = máximo entre updatedAt y las fechas de confirmación.
Los recuerdos antiguos parten de cero confirmaciones; sus revisiones existentes
sí son hechos del historial. No fabricar eventos para aparentar repeticiones pasadas.

```text
ageDays = max(0, (now - lastSeenAt) / un_día)
reinforcements = revisionCount + duplicateCount
multiplier = 1 + 0.10*pinned
               + 0.06/(1 + ageDays/30)
               + 0.04*reinforcements/(reinforcements + 4)
orderScore = BM25 * multiplier
```

Orden ascendente por orderScore, desempate por ID. BM25 de SQLite es negativo:
menor es mejor; no normalizar como probabilidad. Conservar pesos título 5,
contenido 1 y tema 3. Usar un instante fijo por búsqueda para todos los candidatos.

La ruta literal de términos cortos conserva su orden actual y no inventa BM25.
La explicación añade los factores y contadores usados; las vistas breves y la
búsqueda completa deben devolver el mismo orden. No añadir cuerpos completos a
las vistas breves ni cambiar el presupuesto de contexto ya implementado.

## Persistencia, habilitación y compatibilidad

Extensión aditiva del esquema SQLite a versión 7, mediante habilitación explícita,
con tablas de confirmaciones y peticiones de confirmación e índices por memoryId.
Seguir la cadena de habilitación existente de esquemas 3–6 sin activar una conexión
PostgreSQL ni configurar asistentes como efecto secundario.
Abrir, buscar o guardar en una base antigua no la migra silenciosamente.
El asistente de configuración ofrece habilitar la extensión y explica el cambio.
Antes de habilitarla se mantiene el comportamiento anterior.

La validación debe reconocer exactamente el esquema esperado. `IF NOT EXISTS` no
autoriza aceptar una tabla incompatible. Transacción completa o ningún cambio.
No modificar versiones históricas, checkpoints ni revisiones remotas anteriores.
Los campos derivados de refuerzo no se añaden a snapshots históricos de MemoryVersion.

Nuevo payload de sincronización formato 3: conserva los bloques del formato 2 y
añade confirmaciones y peticiones de confirmación como colecciones independientes.
Los clientes nuevos leen formatos 1/2 sin inventar confirmaciones. Los antiguos
rechazan el formato nuevo sin modificarlo; actualizar todos los equipos antes de
usar la extensión compartida. No prometer downgrade después de la habilitación.

Fusionar confirmaciones por ID: mismo ID y mismos datos cuentan una vez; mismo ID
con datos distintos es conflicto. Conservar todas las confirmaciones anteriores.
Dos claves de petición iguales con cargas o resultados diferentes son conflicto.
No sumar contadores importados: derivarlos de los eventos ya reconciliados.
Las confirmaciones concurrentes de una misma versión pueden unirse. Las ediciones
concurrentes de contenido conservan el conflicto existente; no elegir un ganador
silencioso. Una confirmación de una versión antigua no demuestra validez de la nueva.

PostgreSQL mantiene sus tablas de revisiones y estado: evoluciona el payload, no
se borran tablas ni se sustituye el esquema remoto. Mantener el límite de snapshot
de 8 MiB y los errores seguros actuales. No podar eventos para saltar el límite.

## Estructura y verificación

Mantener el monolito modular por responsabilidades. Separar la lógica de métricas
en modules/memory y persistencia de confirmaciones en infrastructure/sqlite;
sus archivos de lógica tendrán pruebas adyacentes. Integraciones entre guardado,
búsqueda y réplica en los `__tests__` del componente correspondiente.

Pruebas obligatorias: creación sin refuerzo; actualización versionada; repetición
exacta; ventana de 15 minutos y sus bordes; reintentos; petición conflictiva;
sesiones y propiedad; Unicode; archivados; aislamiento de projectId/shared;
sustitución por tema; fórmula con reloj fijo, saturación y fechas futuras;
paridad entre vistas breves y completas; explicación y desempates deterministas.

Persistencia: migraciones desde cada versión admitida, rollback, esquema ajeno,
reapertura y datos históricos intactos. Sincronización: ida y vuelta con PostgreSQL
desechable, importación repetida, confirmaciones concurrentes, IDs manipulados,
claves repetidas, pérdida de acuse, conflicto de contenido y clientes antiguos.
Ejecutar suite completa, typecheck y diff --check. No usar datos ni credenciales
reales del usuario. No afirmar éxito hasta disponer de los resultados.

## Entrega y documentación

El diseño se ejecutó mediante el plan por tareas verificables de la misma fecha.
El handoff 11 incluye el prompt para otro modelo que actualice docs/es, docs/en y
Notion: fórmula, ejemplos, limitaciones, habilitación, compatibilidad de equipos
y patrón arquitectónico con su justificación. Verificación integral: 439 pruebas,
0 fallos y 0 omitidas, tipado y diff --check correctos; revisión global aprobada.
No se actualizó Notion ni se publicaron commits o push en esta entrega.
