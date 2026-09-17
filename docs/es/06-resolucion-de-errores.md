# 06. Resolución de Problemas y Catálogo de Errores

> **Etapa:** Memoria Local y Sincronización PostgreSQL Opcional
> **Versiones de esta entrega:** Programa 0.4.0 | Formato de configuración 2 (local) / 3 (con sync) | Esquema SQLite 3 (local) / 4 (con sync)
> **Estado:** Vigente y Activo (Verificado con 90 pruebas en macOS con Bun 1.3.8)
> **Traducción hermana:** [06 (EN). Troubleshooting and Error Diagnostics](../en/06-troubleshooting.md)

Esta guía te permite diagnosticar rápidamente cualquier código de error devuelto por la terminal o el SDK de Forge614 Engram, comprendiendo su causa exacta y cómo resolverlo sin arriesgar tus datos.

---

## 1. Principio Fundamental de Seguridad

> [!IMPORTANT]
> **Nunca borres tu base de datos, tus tablas ni tus puntos de control (*checkpoints*) para "arreglar" un error.**
> Los errores en Forge614 Engram son salvaguardas de seguridad activas. Cuando el sistema detecta un conflicto, una alteración de esquema o permisos inseguros, se detiene intencionadamente para **proteger la integridad absoluta de tus datos y evitar pérdidas silenciosas**.

---

## 2. Catálogo Completo de Códigos de Error

| Código de Error | Mensaje Habitual | Causa Raíz Explicada | Solución Recomendada |
| :--- | :--- | :--- | :--- |
| `INTERACTIVE_REQUIRED` | *"setup necesita una terminal interactiva..."* | Se invocó `setup` desde un script, tubería (`\|`) o entorno desatendido (`isTTY` falso). | En scripts automatizados o CI/CD, utiliza `forge614-engram init`. |
| `INVALID_INPUT` | *"El campo [campo] debe ser texto no vacío..."* o *"scope shared no acepta --project-id..."* | Opciones vacías, caracteres nulos (`\0`), números fuera de rango (`limit`) o banderas incompatibles. | Revisa la sintaxis. Si operas en `shared`, no pases `--project-id`. Si operas en `project`, proporciona su UUID. |
| `PROJECT_NOT_FOUND` | *"Proyecto no encontrado en esta base."* | El `projectId` no existe en la tabla `projects` de `~/.forge614/engram.db`. | Ejecuta `forge614-engram project-list` para verificar los UUIDs de tus proyectos registrados. |
| `VERSION_CONFLICT` | *"La versión esperada no coincide. Lee el tema antes de actualizarlo."* | El valor de `--expected-version` no coincide con la versión activa actual en la base de datos. | Consulta la versión actual con `get` o `history` y actualiza indicando la versión correcta. |
| `REQUEST_CONFLICT` | *"La clave de petición ya corresponde a otro contenido."* | Se reutilizó un `--request-key` previo con un contenido, título o tema diferente. | Si buscas registrar una nueva nota o revisión, utiliza una nueva clave (ej. `--request-key req-02`) o prescinde de ella. |
| `ARCHIVED` | *"Restaura el recuerdo antes de actualizar su tema."* | Se intentó actualizar un tema cuya memoria está en estado archivado. | Ejecuta `restore` sobre ese recuerdo antes de guardar la nueva versión temática. |
| `NOT_FOUND` | *"Recuerdo no encontrado en el alcance seleccionado."* | El ID del recuerdo no existe en la base o no pertenece al proyecto/alcance indicado. | Verifica si el recuerdo era de proyecto o compartido, y revisa que el UUID esté completo y correcto. |
| `CONFIG_NOT_FOUND` | *"Configuración global inválida o inaccesible..."* | No se encuentra el archivo `~/.forge614/.env`. | Ejecuta `forge614-engram init` o `forge614-engram setup` para preparar la configuración. |
| `CONFIG_INVALID` | *"Configuración global inválida o inaccesible. Comprueba su formato..."* | El archivo `.env` o la carpeta no tienen permisos `0600`/`0700`, o su formato es corrupto. | Asegura permisos `0700` en `~/.forge614` y `0600` en `.env`. Revisa que las claves coincidan con el formato 2 o 3. |
| `CONFIG_BUSY` | *"Otra configuración está en curso. No se reemplazó el archivo."* | Existe el cerrojo `~/.forge614/.config-lock` porque otro proceso está ejecutando `setup`. | Espera a que el otro proceso termine. Si fue un cierre abrupto anterior, verifica que no haya procesos activos y retira el archivo de cerrojo. |
| `CONFIG_CHANGED` | *"La configuración cambió mientras respondías. Vuelve a ejecutar setup."* | El archivo `.env` fue modificado o su hash varió mientras respondías las preguntas del asistente. | Vuelve a ejecutar `forge614-engram setup` para configurar sobre la versión más reciente. |
| `LEGACY_CONFIG` | *"Se detectó configuración antigua por proyecto..."* | Existe un directorio antiguo `projects/` dentro de `~/.forge614/`. | Respalda y retira manualmente esa carpeta antigua. El sistema no la borra de forma silenciosa. |
| `MIGRATION_REQUIRED` | *"Formato anterior detectado..."* o *"No se puede habilitar sincronización en este formato."* | La base `engram.db` tiene esquema 1 o 2, o se intentó habilitar sincronización sobre un esquema incompatible. | Conserva tu archivo. El sistema actual requiere esquema 3 para operar localmente o esquema 4 para sincronizar. |
| `DATABASE_MISSING` | *"Falta la base configurada. No se creó un reemplazo..."* | El archivo `.env` existe, pero falta el archivo `engram.db`. | No se crea una base vacía sustituta para evitar pérdidas silenciosas. Recupera tu archivo `engram.db` de tu copia de respaldo. |
| `DATABASE_PATH_UNSAFE` | *"La base o un archivo auxiliar tiene un enlace, propietario o tipo no permitido..."* | `engram.db`, `-wal` o `-shm` son enlaces simbólicos, enlaces duros o tienen dueño ajeno. | Asegúrate de que los archivos sean archivos regulares pertenecientes a tu propio usuario del sistema operativo. |
| `DATABASE_SCHEMA` | *"La estructura no es compatible. No se modificó ni reparó la base."* | Las tablas, disparadores o índices de SQLite no coinciden con la definición canónica. | El sistema rechaza estructuras alteradas o parciales. Utiliza una base legítima de Forge614 Engram. |
| `DATABASE_VERSION` | *"Base incompatible: no se puede abrir con esta versión."* | El `user_version` de SQLite es mayor o incompatible con la versión actual del software. | Actualiza tu ejecutable binario `forge614-engram` a la versión más reciente. |
| `DATABASE_OWNER` | *"La base contiene una estructura ajena; usa una base vacía y dedicada."* | El archivo SQLite contiene tablas creadas por otro software ajeno a Forge614. | Utiliza una base vacía y dedicada exclusivamente para Forge614 Engram. |
| `DATABASE_UNINITIALIZED`| *"La base no está inicializada. Conectar no crea tablas."* | Se abrió la base en modo de solo lectura antes de inicializarla. | Ejecuta `forge614-engram init` o confirma en `setup` para crear las tablas correspondientes. |
| `SYNC_DISABLED` | *"Sincronización PostgreSQL desactivada. Ejecuta setup para configurarla."* | Se ejecutó `sync` o `sync-watch` pero `.env` no tiene `POSTGRES_URL` (formato 2). | Ejecuta `forge614-engram setup` y elige `Sí, configurar PostgreSQL` para activar la réplica. |
| `SYNC_CONFLICT` | *"SYNC_CONFLICT: sincronización detenida; se conservan los datos locales y remotos."* | Cambios incompatibles sobre la misma entidad entre local y remoto, o un registro histórico desaparecido. | Detiene la ronda para proteger los datos. **No hay resolución automática en esta versión**. No borres tablas ni checkpoints. |
| `SYNC_LOCAL_CHANGED` | *"SYNC_LOCAL_CHANGED: sincronización detenida; se conservan los datos..."* | Se produjeron escrituras locales en SQLite mientras se esperaba la respuesta de red de PostgreSQL. | Reintenta la sincronización con `forge614-engram sync` o mantén abierto `sync-watch`. |
| `SYNC_REMOTE_CHANGED` | *"SYNC_REMOTE_CHANGED: sincronización detenida; se conservan los datos..."* | Otra réplica publicó una nueva cabeza en PostgreSQL entre tu lectura y tu publicación (conflicto CAS). | Reintenta la sincronización ejecutando `forge614-engram sync`. La nueva ronda descargará los cambios remotos y reintentará la fusión. |
| `SYNC_INVALID` | *"SYNC_INVALID: sincronización detenida; se conservan los datos..."* | El contenido del snapshot o su hash SHA-256 no es íntegro o falló la validación canónica. | Comprueba que ninguna aplicación externa haya manipulado las tablas `revisions` o `state` en PostgreSQL. |
| `SYNC_TOO_LARGE` | *"SYNC_TOO_LARGE: sincronización detenida; se conservan los datos..."* | La fotografía del espacio de trabajo sobrepasa el límite estricto de seguridad de 8 MiB (8,388,608 bytes). | El espacio excede la capacidad de fotografía completa de esta versión. Archiva datos obsoletos o espera a futuras versiones con transporte incremental. |
| `POSTGRES_URL` | *"POSTGRES_URL: conexión inválida. Usa una URL PostgreSQL completa; TLS verificado es obligatorio..."* | URL con protocolo inválido, sin usuario/base, caracteres ilegales, o intentando `sslmode=disable` fuera de loopback. | Usa `postgres://usuario:clave@host:5432/base`. Para servidores remotos, TLS verificado es obligatorio; `sslmode=disable` solo se admite en `127.0.0.1` o `localhost`. |
| `POSTGRES_UNAVAILABLE` | *"PostgreSQL no disponible o sin permisos. Los datos locales se conservan; comprueba conexión..."* | El servidor PostgreSQL está apagado, no hay conexión a internet, credenciales inválidas o tiempo de espera agotado. | Los datos locales en SQLite continúan operativos al 100%. Comprueba tu red y servidor sin publicar contraseñas. |
| `POSTGRES_UNINITIALIZED`| *"POSTGRES_UNINITIALIZED: sincronización detenida; se conservan los datos..."* | El esquema `forge614_sync` no existe en PostgreSQL y se ejecutó `sync` directo sin pasar por `setup`. | Ejecuta `forge614-engram setup` para inicializar el esquema de sincronización en PostgreSQL. |
| `POSTGRES_SCHEMA` | *"POSTGRES_SCHEMA: sincronización detenida; se conservan los datos..."* | Las tablas `revisions` o `state` en PostgreSQL están alteradas, incompletas o contienen disparadores/reglas ajenas. | La base PostgreSQL debe ser dedicada o compatible canónicamente. No manipules manualmente el esquema `forge614_sync`. |
| `STORAGE_ERROR` | *"No se pudo completar la operación. Comprueba permisos..."* | Error general de entrada/salida a nivel de sistema operativo (disco lleno, bloqueo permanente). | Comprueba el espacio libre en el disco duro y los permisos del sistema operativo. |

---

## 3. Escenarios Operativos y de Recuperación

### 1. Se produce `SYNC_CONFLICT` al sincronizar
- **Causa:** Modificaste el mismo recuerdo o proyecto en dos computadoras distintas sin haber sincronizado previamente entre ambas sesiones.
- **Comportamiento del sistema:** Forge614 Engram detiene la ronda por completo sin tocar ni alterar tus recuerdos en SQLite ni en PostgreSQL. No hay borrado silencioso ni resolución por reloj (*Last-Write-Wins*).
- **Qué NO hacer:** **Jamás borres la tabla `sync_checkpoints`, no elimines `revisions` en PostgreSQL ni borres tu base SQLite.** Hacerlo destruiría la trazabilidad de tus datos.
- **Estado en esta versión:** No existe todavía un comando de resolución interactiva o automática de conflictos. Los cambios permanecen en cada base respectiva a la espera de futuras herramientas de conciliación manual.

### 2. El servidor PostgreSQL está caído o sin conexión (`POSTGRES_UNAVAILABLE`)
- **Comportamiento seguro:** La indisponibilidad de PostgreSQL **jamás bloquea ni degrada tus operaciones locales**. Puedes seguir guardando (`save`), consultando (`get`), buscando (`search`) y archivando (`archive`) recuerdos en SQLite con total normalidad y cero latencia.
- **Observador `sync-watch`:** Emitirá un aviso en `stderr` y continuará reintentando en cada intervalo programado hasta que el servidor o la red se restablezcan.

### 3. Archivo `.config-lock` residual tras un cierre forzado de terminal
- **Causa:** Si la máquina se reinició o la terminal se cerró abruptamente mientras el comando `setup` estaba escribiendo el archivo `.env`, puede quedar un archivo `~/.forge614/.config-lock`.
- **Por qué no se elimina automáticamente:** Porque podría pertenecer a otro proceso legítimo de `setup` ejecutándose en otra ventana de terminal simultáneamente.
- **Solución segura:** Verifica con `ps aux | grep forge614-engram` que no haya otro asistente `setup` en ejecución. Si no hay ninguno, retira manualmente el archivo con `rm ~/.forge614/.config-lock` y ejecuta `setup` de nuevo.

### 4. La URL de PostgreSQL es rechazada con `POSTGRES_URL`
- **Causa común:** Intentar usar `sslmode=disable` hacia una base remota en internet (como Neon, Supabase o un VPS).
- **Política de seguridad:** Por diseño estricto, Forge614 Engram **rechaza conexiones remotas no cifradas o sin verificación de certificado**. La opción `sslmode=disable` está permitida exclusivamente si el host es `127.0.0.1`, `localhost` o `[::1]`.
