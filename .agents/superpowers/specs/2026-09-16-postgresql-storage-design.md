# Entrega 07 — Sincronización PostgreSQL directa, SQLite siempre local

Esta especificación sustituye los borradores de PostgreSQL como backend exclusivo
y del servidor Cloud propio. El usuario aprobó conexión directa con PostgreSQL,
local o remoto. No se implementa un servicio Cloud intermedio.

## Contrato

- Guardados y consultas siempre en ~/.forge614/engram.db, usando SQLite y FTS5.
- Configuración única privada ~/.forge614/.env. No selección de proyectos.
- setup pregunta «¿Quieres habilitar la sincronización con una base de datos PostgreSQL?».
- Opciones: «No» (predeterminada) y «Sí, configurar PostgreSQL».
- La sincronización incluye todo el espacio: proyectos, shared, versiones,
  claves de petición y auditoría. setup explica el alcance antes de confirmar.
- Conservar projectId y scope; no promover recuerdos a shared por sincronizarlos.
- Configurar no registra proyectos ni conecta asistentes. memory_save/MCP sigue pendiente.

## Modelo de replicación de esta primera versión personal

No se implementa un registro nuevo de cada operación en la ruta de guardado.
En su lugar se comparan tres fotografías completas (snapshots): local actual,
último estado sincronizado y remoto actual. Cada memoria incluye todas sus
versiones y eventos, por lo que los cambios guardados offline siguen siendo
detectables aunque el proceso de sincronización no estuviera activo.

Se combinan entidades diferentes. Una modificación incompatible de la misma
entidad detiene la ronda con SYNC_CONFLICT, conservando ambas copias. No se elige
por reloj ni se sobrescribe historial. También se rechazan temas o request keys
duplicados y restauraciones remotas que retrocedan la historia. Validar que el
resultado extiende ambas historias ANTES de publicar, y otra vez al aplicar.

Esta política es deliberadamente conservadora: no hay resolución automática ni
comando de resolución de conflictos en esta entrega. Un conflicto puede requerir
reconciliación asistida posterior; no prometer convergencia automática de ramas
divergentes. Nunca recomendar borrar tablas, checkpoints o recuerdos para resolverlo.

## Persistencia y protocolo

SQLite local-only conserva esquema 3. Habilitar sincronización hace una migración
aditiva explícita a 4 tras validar exactamente el esquema 3: añade sync_checkpoints.
Lecturas normales admiten ambos esquemas exactos y no migran. Desactivar PostgreSQL
no elimina checkpoints ni convierte el esquema 4 de regreso a 3.
Formatos antiguos 1/2 continúan rechazados. Binarios anteriores pueden rechazar 4.

PostgreSQL utiliza únicamente forge614_sync: revisions conserva snapshots por
SHA256, state identifica la réplica y referencia su cabeza actual. La transacción
de publicación bloquea state y exige que la cabeza no haya cambiado (CAS).
Repetir una publicación ya recibida es inocuo. No hay operaciones de borrado
ni recolección automática del historial remoto.

Después de publicar, SQLite aplica datos y checkpoint en una transacción solo
si los datos locales siguen coincidiendo con la fotografía exportada. Si otro
proceso guardó cambios, se rechaza la aplicación obsoleta. Un reintento reconcilia;
si encuentra divergencia, se detiene y conserva ambas copias.

Una respuesta perdida puede dejar PostgreSQL adelantado respecto al checkpoint
local. El hash y la comparación de tres estados permiten repetir sin duplicados
cuando no hay divergencia adicional. No existe transacción distribuida ni promesa
de rollback remoto si la aplicación local falla después de publicar.

## Conexión, configuración y seguridad

URLs postgres/postgresql completas. Credenciales ocultas incluso cuando se pegan
respuestas futuras antes del prompt. PostgreSQL recibe opciones explícitas, sin
fallback a DATABASE_URL/PGHOST del proceso. TLS con verificación fuera de loopback;
sin TLS solo en loopback con sslmode=disable explícito. No se prueban proveedores
comerciales usando credenciales reales.

Configuración sin sincronización: formato 2, STORAGE=sqlite.
Con sincronización: formato 3, STORAGE=sqlite y POSTGRES_URL.
Carpeta 0700 y archivo 0600; publicación atómica y bloqueo entre escritores de
configuración, detección de revisión desfasada, sin imprimir secretos.
Reemplazar conexión requiere confirmación; conserva datos locales y no borra
réplicas anteriores. Una nueva réplica puede recibir todo el espacio local, incluidos
recuerdos que se recibieron anteriormente de otra réplica: la advertencia de setup
abarca todos los datos, no solo los creados en este equipo.

Una base PostgreSQL debe estar dedicada, vacía o ya compatible. Esquemas internos
del proveedor no se tocan. La estructura propia parcial/alterada/incompatible se
rechaza, sin reparación automática. El rol requiere permiso de crear el esquema
durante setup y leer/escribir sus tablas; no requiere superusuario ni extensiones.
Esto no es autorización multiusuario: quien posee acceso a la réplica puede leer
su contenido. El propio propietario/admin PostgreSQL puede modificarlo.

## Ciclo de vida

sync ejecuta una ronda explícita. sync-watch repite en primer plano cada 30 segundos
(intervalo configurable 1–3600). Sin proceso activo no hay reintentos en segundo plano.
No instalar demonios, servicios de inicio, tareas ni configuración de shell.
Las operaciones locales jamás esperan esa conexión. Ctrl+C detiene el observador;
una operación de red en curso puede tardar hasta su timeout en finalizar.
Desactivar conexión detiene futuras rondas; una ya confirmada/en curso no se deshace.

setup verifica conexión después de confirmación, inicializa solo estructura vacía
compatible y publica configuración. No sincroniza datos automáticamente: indica
ejecutar sync o mantener sync-watch. No presentar selección habilitada como un
proceso permanentemente activo.

## Límites y pruebas

Snapshot máximo 8 MiB; coste proporcional al espacio completo. No es un protocolo
incremental optimizado, no comprime, no cifra contenido de extremo a extremo y no
sustituye backups. FTS no se replica: se reconstruye mediante triggers SQLite al
incorporar datos. Conflictos bloquean la ronda completa.

Pruebas con dos SQLite y PostgreSQL real aislado: compatibilidad, reintentos,
concurrencia CAS, respuesta perdida, escritor local simultáneo, conflictos,
historial, shared, FTS, offline, cancelación y secretos. Suite PostgreSQL requiere
FORGE614_TEST_POSTGRES_BIN con binarios locales para crear un cluster temporal;
si no se proporciona, esas pruebas aparecen omitidas, no como aprobadas.
Nunca usar datos ni credenciales reales del usuario como fixtures.

Ver entrega técnica y prompt documental en docs/handoffs/07-postgresql-sync.md.
