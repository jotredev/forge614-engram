# Entrega 09 — Recuperación progresiva inspirada en Gentleman Engram

Estado: diseño aprobado e implementado; revisiones y verificación final completadas el 2026-09-17.
Base: main 193e89a, versión 0.5.0.
Rama existente: feat/ranked-memory-context. Sin commit ni push.

## 1. Cambio solicitado por el usuario

El usuario pidió seguir el funcionamiento de Gentleman Engram. Esta revisión
sustituye la propuesta anterior de paquetes de recuerdos completos con una
fórmula nueva de puntuación.

Se retiran de esta entrega la fórmula context-v1 0.85/0.10/0.05, su normalización
a 0–1 y la selección de recuerdos enteros según un presupuesto de paquete.
No estaban implementadas. No se cambia ni elimina ningún recuerdo.

La nueva dirección es recuperación progresiva: mostrar información breve para
localizar candidatos y leer el original completo solo cuando sea necesario.
La preferencia anterior por recuerdos completos queda aplicada a la lectura
final y al almacenamiento; las vistas previas se identifican como parciales.

## 2. Referencia verificada, no equivalencia supuesta

Referencia fijada: Gentleman-Programming/engram, commit
ca12c5a00687b98a2c55635495f93f51a642fe79, consultado 2026-09-17.

Su flujo documentado es búsqueda, vecindad cronológica de la misma sesión y
lectura completa por ID. El código MCP usa SearchPreviewsContext; distingue
preview/truncated y obtiene el contenido íntegro en handleGetObservation.
handleTimeline consulta observaciones de la misma sesión. mem_context cumple
otra función: orientación reciente, no ranking de candidatos para una consulta.

Corrección de la comparación previa: handleContext actualmente usa 16 KiB por
defecto para contexto MCP. Coincide numéricamente con la propuesta anterior,
pero eso no convierte nuestro algoritmo de empaquetado en el suyo. No asumir
que main coincide con una versión estable publicada.

Fuentes:
- https://github.com/Gentleman-Programming/engram/blob/ca12c5a00687b98a2c55635495f93f51a642fe79/internal/mcp/mcp.go
- https://github.com/Gentleman-Programming/engram/blob/ca12c5a00687b98a2c55635495f93f51a642fe79/DOCS.md
- https://github.com/Gentleman-Programming/engram/blob/ca12c5a00687b98a2c55635495f93f51a642fe79/docs/ARCHITECTURE.md

## 3. Qué se conserva de Forge614

Una configuración global y una engram.db; SQLite/FTS5 local; projectId estable;
shared explícito; sustitución por tema del proyecto; historial e idempotencia.
No cambiar estos contratos para copiar diferencias ajenas de ownership o alcance.
Mantener comprobación de propietario también en lecturas por ID.

No añadir modelo independiente, captura de conversaciones, búsqueda semántica,
entrenamiento, servidor Cloud ni puntuaciones que aparenten probabilidad de verdad.
No escribir en configuraciones de asistentes ni ejecutar sesiones reales sin
autorización. No cambiar código de producto durante la revisión de este diseño.

## 4. Flujo propuesto en nuestras herramientas

### Localizar: memory_search

Devolver una lista breve de candidatos: ID, título, tipo, alcance, projectId,
tema cuando exista, versión, fecha y vista previa. Identificar inequívocamente
que preview no es el contenido íntegro; incluir truncated cuando corresponda.
No devolver también el cuerpo completo en otro campo: eso anularía el ahorro.

La vista previa es un extracto determinista del texto guardado, no un resumen
inventado por IA. Respetar Unicode y no modificar el contenido almacenado.
Vista previa de hasta 300 puntos de código Unicode, como la proyección SQL
SearchPreviewsContext de la referencia fijada. No son 300 bytes ni 300 tokens.
Seleccionar solo metadatos y extracto desde SQLite; no cargar todos los cuerpos
en JavaScript para recortarlos después. La ruta literal debe conservar su
comparación Unicode actual aunque requiera procesar filas individualmente.

Preservar FTS5 y la ordenación actual en esta primera adaptación. Las mejoras
matemáticas adicionales quedan separadas, no descartadas definitivamente.
Mantener query, limit, alcance y errores explícitos, sin resultados de otros
proyectos ni fallback a shared cuando falte identidad.

Cambiar el resultado MCP requiere contrato y pruebas de compatibilidad explícitos.
Conservar MemoryStore.search y la salida CLI existente; añadir un servicio de
vistas previas y una opción CLI explícita, sin truncar silenciosamente APIs previas.

### Contextualizar: memory_timeline cuando exista información de sesión

Para equivalencia real con Gentleman se requiere saber a qué sesión pertenece
cada recuerdo. Nuestra base actual NO tiene sesiones ni asociación memory-session.
memory_history es historial de versiones de un recuerdo, no una sesión; no usarlo
como sustituto ni llamar sesión a recuerdos cercanos por fecha.

La réplica de esta capa requiere una ampliación aditiva de sesiones, asociaciones,
reglas de inicio/cierre y sincronización. Los recuerdos antiguos sin sesión deben
mantenerse íntegros, sin asignarles una sesión inventada. Esa ampliación necesita
su propio diseño de datos antes de implementación.

El usuario eligió incluir sesiones y timeline en esta entrega. Se implementan
las tres capas; no afirmar equivalencia de todos los subsistemas de Gentleman.
Las sesiones no autorizan guardar transcripciones ni todos los prompts.

### Leer: memory_get

Recuperar el texto completo de un candidato por su ID y alcance correcto,
conservar versión y metadatos. No recortar, resumir ni sobrescribir el original.
El asistente debe leerlo antes de apoyarse en condiciones o decisiones que una
vista previa pudiera omitir. La lectura puede detectar una versión actualizada
desde la búsqueda; no prometer que son la misma instantánea.

El modelo decide cuándo explorar o profundizar, guiado por instrucciones claras.
No hacer obligatoriamente tres llamadas si no necesita el contexto intermedio.
No prometer que los modelos siempre obedecen el protocolo.

## 5. Contexto reciente y límites

memory_context se incorpora como orientación reciente, no como búsqueda con la
fórmula descartada. Sus secciones y límites se especifican más adelante.

Las vistas previas reducen información entregada, no garantizan un número de
tokens ni que el historial completo quepa en la ventana de cualquier modelo.
Una lectura íntegra puede ser larga. No confundir memoria persistente guardada
con contexto temporal enviado en una llamada.

## 6. Integración y verificaciones previstas

Actualizar MEMORY_PROTOCOL y descripciones: localizar, contextualizar si hace
falta y leer íntegro antes de confiar en detalles. No sobrescribir plugins
OpenCode existentes que tengan instrucciones incrustadas distintas; documentar
la actualización explícita y conservar políticas de configuración seguras.

Pruebas: búsqueda breve sin cuerpo completo oculto en otro campo; Unicode y
marcador parcial; lectura íntegra exacta; orden y aislamiento existentes;
shared y topic overrides; lectura sin efectos secundarios; MCP compilado real.
Si se incluye timeline, añadir pruebas de separación por sesión, migración
aditiva, recuerdos sin sesión, réplica y ausencia de transcripciones.

Mantener autoprueba del servidor coherente con las herramientas realmente
entregadas. No anunciar una herramienta aún pendiente de sesiones.

## 7. Documentación y siguiente decisión

La fórmula de recencia/prioridad que describen las guías actuales no coincide
con store.ts. El handoff debe pedir corregirla con el código como fuente:
1 + 0.10*pinned + 0.06/(1+ageDays/30). No cambiarla para justificar el documento.

Otro modelo actualizará docs/es, docs/en y Notion. Entregar prompt detallado,
lenguaje sencillo con términos técnicos entre paréntesis, ejemplos y distinción
entre comportamiento de Gentleman y adaptación propia. No commit/push.

Sesiones y timeline quedan incluidos por aprobación del usuario. Después de
revisar las decisiones técnicas siguientes se elaborará el plan; este documento
no constituye implementación terminada.

Autorrevisión: elimina el ranking propuesto, corrige la comparación de 16 KiB,
distingue vista previa de original y sesión de versión, mantiene seguridad y
expone explícitamente la dependencia de sesiones sin fingir equivalencia.

## 8. Sesiones: identidad y ciclo de vida propuestos

Una sesión runtime representa una conversación de trabajo, no un proceso MCP ni
todos los chats abiertos de un proyecto. Existe además una sesión de guardados
independientes (kind manual) que NO representa una conversación identificada.
sessionId es independiente de projectId; propietario inmutable de proyecto,
startedAt y endedAt nullable. No prompts, secretos ni transcripciones. Una sesión
no puede cambiar de proyecto ni reabrirse cerrada. Las rutas de resolución son
locales, no campos replicados de la sesión.

memory_session_start acepta directory y un sessionId opaco elegido por el cliente
para que reintentar sea seguro. Resuelve o crea el proyecto con las mismas reglas
de ambigüedad actuales; creación del proyecto, binding y sesión en una transacción.
Sesión existente abierta del mismo proyecto: devolverla sin duplicar. ID ocupado
por otro proyecto o cerrado: error sin cambios. No recuperar por nombre ni tomar
automáticamente la última sesión abierta de otro cliente.

Aceptar identificadores de integración sin obligar a transformarlos a UUID:
texto 1–200 caracteres, sin controles, espacios exteriores ni NUL. No aceptar
texto de conversación como identificador. El asistente usa el ID estable que su
integración conozca o genera un UUID para esa conversación cuando no lo tenga.

El protocolo indica conservar el ID por conversación, pasarlo al guardar cuando
esté disponible y recuperarlo desde su propio contexto después de compactación.
No afirmar que MCP entrega automáticamente el ID nativo de cada chat. Los hooks
recuerdan el protocolo, no leen conversaciones ni prometen detectar todos los
inicios/cierres reales. No ampliar esta entrega a captura de identidad por cinco
plugins distintos ni asignar el PID del servidor como identidad de conversación.

memory_save admite sessionId opcional para compatibilidad con clientes anteriores.
En esquema 6, los guardados de proyecto siguen esta resolución:

1. sessionId explícito: autoridad de sesión, comprobar proyecto y estado. No
   sustituir una selección errónea por otra implícita.
2. Sin ID: buscar sesiones runtime abiertas del proyecto y directorio runtime
   local, con actividad registrada dentro de siete días. La actividad es el máximo
   entre startedAt y las fechas de entradas de esa sesión, no una lectura de memoria.
3. Una candidata: usarla. Más de una: AMBIGUOUS_SESSION antes de guardar; devolver
   IDs candidatos del mismo proyecto y explicar cómo indicar uno o cerrar otro.
4. Ninguna: usar/crear una sesión manual separada, claramente etiquetada, sin
   presentarla como la conversación actual. No elegir la más reciente.
5. Error de consulta: fallar sin escritura; no tratar el error como cero candidatas.

Las reglas 1–4 reproducen el patrón de resolveFallbackSessionID y
ActiveRuntimeSessions de la referencia. La regla 5 es una adaptación de seguridad:
no copiar el fallback del código de referencia tras error de consulta.

La ventana de siete días solo limita la inferencia automática; no cierra sesiones
ni impide referir explícitamente una sesión abierta más antigua. Fijar un reloj
por petición y probar exactamente el borde de la ventana.

El directorio runtime es la raíz canónica del worktree concreto (no el directorio
Git común usado para projectId). Subcarpetas comparten contexto runtime; dos
worktrees comparten proyecto, pero no mezclan inferencia de sesiones. Sin Git se
usa la raíz explícita validada. Guardar las asociaciones de rutas en una tabla
local, nunca exportarlas ni importar rutas de otros equipos.

Antes de habilitar esquema 6, los guardados existentes sin sessionId mantienen
su comportamiento sin crear sesiones; no migrar desde memory_save. Las operaciones
de sesión explícitas requieren habilitación. Las escrituras shared sin contexto
de proyecto siguen siendo válidas y sin sesión; no inventar un proyecto para ellas.
Shared con sessionId exige validar el proyecto propietario resuelto explícitamente.

Guardar versión y asociación ocurre atómicamente. Un error no deja memoria,
versión, entrada cronológica o proyecto parcialmente creados.

SDK y CLI mantienen el guardado independiente: sin sessionId no se unen a una
conversación MCP; en esquema 6 usan la sesión manual del proyecto. Un ID explícito
permite asociación deliberada. Esto ofrece la misma vía de salida independiente
que propone Gentleman ante varias sesiones runtime abiertas.

El resultado MCP indica sessionId y sessionSource (explicit, inferred o manual)
para guardados de proyecto. En shared evitar revelar asociación de origen a otro
proyecto. La inferencia no es autenticación de cliente ni certeza de que una única
sesión registrada represente todos los chats realmente abiertos.

memory_session_end cierra una sesión explícita. Repetir el cierre sin cambios es
idempotente; no alterar la hora original. Cerrar no genera por sí solo un resumen.
No cerrar automáticamente una sesión por EOF del MCP: un cliente puede reiniciarlo.
Un cierre brusco puede dejar una sesión abierta, visible como tal, sin resumen ficticio.
Las sesiones manuales no se cierran ni resumen con las herramientas de conversación;
rechazar esas operaciones en kind manual para no simular un chat o reabrirlo luego.
Esto es una adaptación explícita de nuestro contrato, no una regla atribuida al upstream.

## 9. Modelo de datos propuesto

Esquema SQLite 6 aditivo sobre la estructura validada 5:

- sessions: sessionId, projectId, kind (runtime/manual), startedAt, endedAt.
- session_entries: sessionId, memoryId, version, recordedAt. Referencia a la versión
  ya existente; no duplica cuerpos. Una versión tiene como máximo una sesión de origen.
- session_summaries: sessionId, memoryId, version. Referencia al resumen vigente
  como recuerdo de procedimiento del proyecto; historial sigue en memory_versions.
- local_session_bindings: sessionId y directorio runtime canónico. Solo datos de
  este equipo, excluidos del snapshot y preservados al importar.
- local_manual_sessions: projectId y sessionId manual usado en este equipo.
  Creación concurrente produce una única asociación mediante transacción.

Los IDs manuales son UUID generados una vez por proyecto/equipo y persistidos en
local_manual_sessions. Distintos equipos pueden tener sesiones manuales distintas
del mismo proyecto sin colisionar en inicio o contenido. Gentleman usa un nombre
manual-save por proyecto; nuestro ID es una adaptación necesaria para no confundir
ese contenedor local con una conversación compartida al reconciliar snapshots.
Ni kind manual ni local_manual_sessions autorizan inferir una sesión runtime.

Índices por proyecto/fecha y sesión/fecha; integridad referencial verificable.
Las migraciones no asignan sesiones a recuerdos históricos ni reescriben versiones,
request hashes o eventos. Las llamadas sin sesión explícita se rigen por las reglas
de inferencia/manual de la sección 8, no por una asociación obligatoria.

Habilitación explícita con sessions-enable, idempotente, dentro de transacción.
En versiones 3/4 añade también las estructuras intermedias de sync/bindings;
normal open, búsqueda, lectura y arranque MCP nunca migran automáticamente.
Conservar validación exacta de estructuras antes de añadir tablas: IF NOT EXISTS
por sí solo no demuestra que una tabla previa sea compatible. Nunca borrar para reparar.
Bases ajenas/futuras/malformadas permanecen intactas. No downgrade automático.

Una asociación apunta a la versión guardada EN esa sesión. Actualizar el mismo
tema en otra sesión crea otra versión y otra entrada, no mueve el pasado.
Reintentar requestKey en la misma sesión no duplica entradas. Reutilizarlo para
atribuir una versión existente a otra sesión, o a una sesión histórica inventada,
se rechaza explícitamente; los hashes de solicitudes anteriores se conservan.
Un replay exacto ya aplicado puede responder tras cerrar la sesión sin escribir;
una escritura nueva en sesión cerrada falla. Con requestKey sin sessionId, resolver
primero el replay validado y conservar su asociación original aunque ahora haya
otras sesiones candidatas; no moverlo, duplicarlo ni anexar una sesión a un recuerdo
antiguo que carecía de ella. No crear una sesión manual como efecto de ese replay.

Shared mantiene su intención global explícita. Puede guardarse durante una sesión
de proyecto, pero la asociación de origen pertenece a esa sesión privada.
Buscar/leer shared desde otro proyecto no revela el ID de sesión ni sus vecinos.
Timeline exige el proyecto propietario de la sesión incluso si el foco es shared.

## 10. Timeline, lectura versionada y contexto reciente

memory_timeline recibe sessionId y un foco memoryId/version; before y after por
defecto 5, rango 0–20. El foco debe pertenecer a esa sesión y al proyecto resuelto.
Devolver vecinos solo de esa sesión, ordenados por recordedAt, memoryId y version.
Es orden registrado, no causalidad absoluta entre máquinas con relojes distintos.
Foco con vista previa hasta 500 puntos de código; vecinos hasta 150, siguiendo
los límites de presentación observados en la referencia. Identificar truncación.
Siempre IDs, versiones y metadatos suficientes para profundizar.

Si un recuerdo no tiene asociación de sesión, informar NO_SESSION_CONTEXT; nunca
inventar vecinos. Si su versión aparece en otra sesión, no cambiar silenciosamente
el foco. No mostrar sesiones/entradas ajenas. Omitir memorias actualmente archivadas;
foco archivado no recuperable por timeline. Las reglas de acceso a historia existentes
siguen disponibles por sus operaciones explícitas.

memory_get conserva lectura íntegra por defecto de la versión actual y añade
version opcional para leer exactamente el original al que apunta timeline.
La respuesta distingue versión leída de versión actual. No llamar actual a un
texto histórico. Todas las versiones mantienen comprobación de propietario.

memory_session_summary guarda un procedimiento estructurado: objetivo, instrucciones
duraderas, descubrimientos, trabajo realizado, próximos pasos y archivos relevantes.
Es contenido elegido por el asistente, no una transcripción. Tema reservado
session/<sessionId>/summary; actualizar exige expectedVersion e idempotencia.
Debe guardarse antes del cierre. Asociación de resumen y memoria atómicas; un
reintento exacto no crea duplicados. Excluir credenciales y datos personales.

memory_context no requiere query. Devuelve orientación de un proyecto: recuerdos
fijados aplicables (máximo 20), recuerdos recientes (máximo 20) y resúmenes de
sesiones recientes del proyecto (máximo 5). Estos límites de secciones son nuestra
adaptación explícita, no una afirmación de paridad de todos los defaults upstream.
Evitar duplicar el mismo memoryId/version en varias secciones. Respetar topic
overrides y excluir archivados; shared no muestra resúmenes privados de proyectos.

Vistas previas hasta 300 puntos de código; compact omite extractos, no IDs/títulos.
maxBytes por defecto 16384, rango 1024–65536; validación estricta propia. Limitar el
JSON completo del resultado, metadatos incluidos, no el envoltorio JSON-RPC.
Eliminar filas completas de la presentación en orden de prioridad de sección
antes de exceder el límite, devolver omitted/truncated; no emitir JSON cortado.
Esta adaptación no copia el truncado de texto renderizado de Gentleman. No afecta
a originales, ni se presenta como presupuesto exacto de tokens del cliente.

## 11. Sincronización compatible y sin pérdida

El formato actual de snapshots 1 valida claves exactas. Añadir sesiones a ese
formato sin cambiar versión sería incompatible o causaría pérdida de información.
Proponer snapshot format 2: proyectos y memorias intactos, más sessions,
sessionEntries y sessionSummaries. project_bindings, local_session_bindings y
local_manual_sessions siguen exclusivamente locales.

El código nuevo lee formato 1 sin inventar sesiones. Conserva su hash original
para comparación CAS remota; convertir en memoria no puede sustituir ese hash.
Snapshots 1 anteriores de checkpoints son base válida para reconciliar, con
colecciones nuevas vacías. Sucesores formato 2 no pueden volver a formato 1.
Revisiones PostgreSQL históricas permanecen intactas, sin rehash ni borrado.

state.format de PostgreSQL representa la estructura del almacén de réplica, que
sigue en 1; payload.format identifica la versión del snapshot. No cambiar el DDL
remoto si no hace falta. Esta distinción debe quedar explícita y probada.

Promover por primera vez el head remoto de payload 1 a 2 requiere confirmación
scriptable explícita: sync --upgrade-format. sync/sync-watch normales informan
SYNC_UPGRADE_REQUIRED antes de publicar o aplicar cambios si hace falta promover.
Después de promoción, binarios anteriores rechazan formato 2, no lo ignoran;
explicar que deben actualizarse todos los equipos antes de volver a sincronizar.
No prometer compatibilidad bidireccional con binarios 0.5.0.

Un cliente nuevo con esquema local sin sesiones debe pedir sessions-enable antes
de importar formato 2; nunca publicar una mezcla y fallar después por esquema local.
Validar capacidades locales/remotas, límites y referencias ANTES de publicación.
Lectura/escritura local sigue funcionando aunque no pueda sincronizar por versiones.

Reconciliar sesiones diferentes por sessionId opaco. Datos de identidad/inicio/kind inmutables;
cierre puede avanzar de abierto a cerrado, nunca reabrirse. Cierres divergentes
de la misma sesión producen SYNC_CONFLICT, no elegir un reloj ganador arbitrario.
Entradas inmutables se unen por memoria/versión; asociaciones incompatibles se
rechazan. Resúmenes siguen historial de memoria y reglas de conflicto existentes.
Preservar límite 8 MiB, CAS, validación de prefijos y transacción local de importación.

## 12. Superficie, entrega y aceptación

MCP añade memory_session_start, memory_session_end, memory_session_summary,
memory_timeline y memory_context: diez herramientas con las cinco existentes.
Usar nombres completos, sin adoptar abreviaturas mem_. Mantener lista común y
verificar registro real en autoprueba. CLI/SDK proporcionan equivalentes sin
prompts obligatorios; documentar cada parámetro y error en el handoff.

Implementación en bloques internos, no cinco entregas independientes:
1. Esquema/sesiones/asociaciones y escrituras atómicas.
2. Snapshot 2, reconciliación y promoción remota explícita.
3. Previews/timeline/contexto y lecturas versionadas.
4. MCP/CLI/protocolo/autoprueba y verificación integral.

Pruebas adicionales obligatorias: dos chats paralelos del mismo proyecto;
inicio/replay/cierre; resúmenes y versiones; shared sin fuga de origen; sesiones
antiguas ausentes; rollback de fallos; migración de 3/4/5; remoto formato 1 a 2;
cliente viejo rechazando el nuevo; CAS concurrente durante promoción; referencias
invalidas; asociación incompatible; importación sin pérdida de bindings locales;
offline y recuperación. PostgreSQL siempre temporal, nunca credenciales del usuario.
Añadir casos cero/una/varias candidatas, siete días/borde/futuro, worktrees distintos,
sesiones importadas sin ruta local, error SQL sin fallback, guardado CLI independiente,
registro manual concurrente y replay sin ID tras cambio de candidatas. No equiparar
salida correcta del resolver con certeza de identidad de una conversación no registrada.

Las cinco secciones previas de datos/ciclo/contexto/sync/superficie son propuestas
técnicas propias adaptadas al sistema existente. El usuario aprobó incluir sesiones,
incluida la corrección final de resolución automática; se puede pasar al plan de implementación.
No modificar docs/es, docs/en ni Notion; entregar handoff y prompt al finalizar.

## 13. Resultado de la revisión de paridad

Patrón tomado de Gentleman: preview/timeline/full-get; sesiones explícitas con
resolución omitida cero/una/varias candidatas; filtro de directorio y siete días;
contenedor manual separado para guardados sin sesión runtime identificada.

Adaptaciones conservadas y declaradas: UUID de proyecto y scopes project/shared;
versiones históricas inmutables; rutas solo locales; IDs manuales por equipo;
fallar ante error de consulta; ownership de lecturas/cierre; snapshot 2 y promoción
explícita; JSON válido limitado en bytes. No decir que el sistema entero es idéntico.

La implementación y las revisiones se completaron siguiendo el plan
`docs/superpowers/plans/2026-09-17-progressive-memory-sessions.md`.
No se ejecutaron migraciones sobre datos personales ni se cambiaron configuraciones
personales. El resultado y el prompt de documentación están en
`docs/handoffs/09-progressive-memory-sessions.md`. No se hizo commit ni push.
