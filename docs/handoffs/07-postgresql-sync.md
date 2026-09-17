# Entrega 07 — Sincronización PostgreSQL opcional

## Cambios implementados

Programa **0.4.0**, en la rama feat/postgresql-storage. PostgreSQL no sustituye
SQLite: el guardado y la búsqueda FTS5 siguen siendo siempre locales. No hay
servidor Cloud propio ni integración memory_save/MCP todavía.

setup muestra exactamente las opciones **No** (predeterminada) y
**Sí, configurar PostgreSQL**. No se utiliza «remoto» porque PostgreSQL puede
estar en el mismo equipo. Tampoco se usa «Cloud» para esta función.

La opción afirmativa solicita la URL completa en entrada oculta. El rol debe
poder crear el esquema propio cuando no existe y leer/escribir en él. No se
solicita proyecto: replica todo el espacio, incluidos shared e historial. Esta
advertencia aparece antes de confirmar. Configurar no envía recuerdos todavía;
al terminar indica cómo iniciar la sincronización.

## Comandos reales

```sh
forge614-engram setup
forge614-engram sync
forge614-engram sync-watch
forge614-engram sync-watch --interval 60
```

- sync: una ronda, salida JSON con synchronized/projects/memories.
- sync-watch: ronda inmediata y reintentos en primer plano; 30 segundos por
  defecto, intervalo válido 1–3600. Ctrl+C termina. No instala servicios.
- Si el observador no está abierto, no hay reintentos automáticos. Los cambios
  permanecen en SQLite y se detectan en la siguiente ronda.
- Una caída de PostgreSQL no bloquea save/search/get ni cambia el resultado
  de un guardado local a error de sincronización.
- Los comandos de recuerdos y proyectos anteriores conservan sus interfaces.

## Configuración y formatos

Una sola carpeta ~/.forge614/ con permisos 0700 y un solo .env 0600.
Sin PostgreSQL se conserva formato 2 con STORAGE="sqlite".
Con PostgreSQL: FORMAT_VERSION="3", STORAGE="sqlite", POSTGRES_URL="...".
Nunca incluir credenciales reales en ejemplos, argumentos de shell o Notion.
No se utilizan variables ambientales de conexión como alternativa silenciosa.

SQLite conserva esquema 3 si solo se usa local. Al habilitar sincronización,
una migración aditiva validada añade sync_checkpoints y establece esquema 4.
No elimina ni reconstruye tablas existentes. Deshabilitar PostgreSQL no revierte
esquema 4 ni borra checkpoints/recuerdos. Versiones SQLite 1/2 siguen rechazadas.
Un binario antiguo puede rechazar el esquema 4; no prometer downgrade automático.

PostgreSQL crea solo el esquema forge614_sync y sus tablas revisions/state.
Conserva revisiones por hash y una cabeza actual. Debe usarse una base dedicada
vacía o una instalación Forge614 compatible. La validación rechaza estructuras
parciales/alteradas, no se limita a IF NOT EXISTS. No toca esquemas del proveedor.

TLS verificado para conexiones fuera de loopback. Para PostgreSQL de desarrollo
en 127.0.0.1/localhost/::1 se admite sslmode=disable explícito. No se desactiva
la verificación para hacer funcionar un certificado remoto problemático.

## Cómo funciona y qué NO promete

Compara tres fotografías completas: último estado sincronizado, SQLite actual y
PostgreSQL actual. Combina cambios de entidades distintas. Cada fotografía incluye
historial, auditoría y claves de petición. Máximo 8 MiB por fotografía.

Los cambios incompatibles sobre la misma entidad producen SYNC_CONFLICT. No se
elige por hora del equipo ni se pierde una revisión. El conflicto detiene la
ronda completa. **No hay comando ni resolución automática de conflictos todavía**:
reportarlo como limitación; no recomendar borrado/reset de tablas o checkpoints.

PostgreSQL conserva revisiones enviadas y evita publicaciones duplicadas. SQLite
actualiza datos/checkpoint en una transacción y rechaza aplicar una fotografía
si hubo cambios locales mientras esperaba la red. Puede reintentarse; si hay
divergencia adicional se detiene conservando copias. No es una transacción
distribuida ni una garantía de que ambas bases cambien exactamente al mismo tiempo.

La búsqueda sigue siendo FTS5 local, con las mismas fórmulas. No existe modo
postgres-fts, tsvector ni ts_rank_cd en esta implementación. Los datos recibidos
actualizan el índice local mediante los triggers existentes.

Esta versión es personal y basada en fotografías completas, no un transporte
incremental optimizado. No hay compresión, limpieza automática de revisiones,
cifrado de extremo a extremo, gestión multiusuario ni backups automáticos.

El projectId se conserva al replicar; nombres iguales no fusionan proyectos.
La futura identificación automática de carpetas/proyectos sigue pendiente.
La sincronización no decide qué es shared ni vuelve global un recuerdo local.

Desactivar en setup detiene futuras rondas y conserva ambas copias; no cancela
retroactivamente una ronda ya en curso. Cambiar de conexión conserva datos
locales y puede enviar el espacio completo a la nueva réplica, incluidos datos
recibidos de una réplica anterior: requiere confirmación consciente.

## Errores y seguridad

SYNC_DISABLED, SYNC_CONFLICT, SYNC_LOCAL_CHANGED, SYNC_REMOTE_CHANGED,
SYNC_INVALID, SYNC_TOO_LARGE; POSTGRES_URL, POSTGRES_UNAVAILABLE,
POSTGRES_UNINITIALIZED, POSTGRES_SCHEMA; CONFIG_BUSY y CONFIG_CHANGED.
Consultar condiciones exactas en código; no inventar opciones de reparación.

Antes de confirmar setup no conecta ni transmite. Una falla remota conserva la
configuración anterior. Después de confirmar puede quedar creada la estructura
remota si falla un paso local: no se borra como compensación. Un cierre abrupto
durante reemplazo puede dejar .config-lock; no se elimina automáticamente porque
podría corresponder a otro proceso activo. Requiere revisión del operador.

## Pruebas reproducibles

Verificación final: **90 pruebas aprobadas, 0 fallos y 645 aserciones**, en 11
archivos, incluyendo PostgreSQL real aislado. `bun run typecheck` y
`git diff --check` finalizaron sin errores. También se verificó que sync-watch
reporta la desconexión, permite guardar localmente y termina con Ctrl+C.
No se ejecutaron commit ni push ni se usó la base de datos personal del usuario.

Suite normal: bun test; bun run typecheck; git diff --check.
Para incluir las pruebas de PostgreSQL real:

```sh
FORGE614_TEST_POSTGRES_BIN=/ruta/a/postgresql/bin bun test
```

El directorio debe tener initdb/pg_ctl y sus bibliotecas. La suite crea un cluster
temporal en loopback con datos sintéticos y lo detiene/elimina al terminar.
Sin esta variable, las pruebas de integración PostgreSQL se omiten explícitamente.
No usar DATABASE_URL ni una base real del usuario para ejecutar esas pruebas.

Se usaron binarios PostgreSQL 17.6 aislados en macOS y Bun 1.3.8. La suite incluye
compilación/instalación temporal del ejecutable y pruebas de la CLI; las pruebas
PostgreSQL ejecutan TypeScript con Bun. No afirmar verificación en Neon/Supabase
reales ni en todas las plataformas/proveedores.

## Prompt para el modelo de documentación

```text
Actualiza la documentación de Forge614 Engram para la Entrega 07 implementada.
Lee docs/handoffs/07-postgresql-sync.md, la especificación actual
docs/superpowers/specs/2026-09-16-postgresql-storage-design.md y el código/pruebas.

Mantén docs/es/ y docs/en/ separadas, completas y equivalentes. Conserva índices
01–08 y actualiza navegación. Explica en lenguaje cotidiano, seguido del término
técnico entre paréntesis. Actualiza Notion en ambos idiomas si tienes acceso;
si no, reporta lo pendiente sin afirmar sincronización de documentación.

Integra instalación, recorrido, CLI, SDK, arquitectura, errores, glosario y roadmap.
Explica SQLite siempre activo, PostgreSQL opcional directo y sin servidor Cloud.
Usa las etiquetas exactas No / Sí, configurar PostgreSQL. No agregues proyectos
al setup ni describas el proceso como elección de backend exclusivo.

Documenta sync y sync-watch con ejemplos seguros, funcionamiento offline y necesidad
de mantener sync-watch abierto para reintentos. Configurar no instala un servicio
ni envía recuerdos por sí solo. La primera ronda replica todo el espacio.

Explica .env único, formato 2/3, esquema SQLite 3/4 y migración aditiva al habilitar;
la compatibilidad hacia atrás tiene límites. Nunca copies credenciales reales.
Mantén FTS5 local y elimina cualquier propuesta de búsqueda ts_rank_cd PostgreSQL.

Describe snapshots, checkpoints, CAS, historiales, validación y conflictos según
el código. Destaca el límite 8 MiB, coste de fotografías completas y ausencia de
resolución de conflictos. No inventes comandos de resolución, reset, backups,
sincronización selectiva, servicio Cloud, autenticación multiusuario ni MCP.

La API SQLite existente sigue síncrona. Los módulos de sincronización no se
reexportan como API pública por src/index.ts; no inventes AsyncMemoryWorkspace.
Las funciones de exportación/aplicación del store son infraestructura interna,
no instrucciones para pegar JSON desconocido ni resolver conflictos manualmente.

La política futura sigue projectId por defecto y shared solo por intención
explícita global, interpretada en contexto; esa integración de IA no está hecha.

Ejecuta pruebas con entorno aislado y reporta cuántas pasaron y cuáles se omitieron.
No modifiques código, pruebas, archivos del usuario ni hagas commit, push o PR.
Entrega lista de archivos/páginas modificados y cualquier limitación pendiente.
```
