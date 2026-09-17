# 06. Resolución de Problemas y Catálogo de Errores

> **Etapa:** Etapa 1 — Memoria Local (Una Sola Base y Recuerdos Compartidos)
> **Versiones de esta entrega:** Programa 0.2.0 | Formato de configuración 2 | Esquema SQLite 3
> **Estado:** Vigente y Activo
> **Traducción hermana:** [06 (EN). Troubleshooting and Error Diagnostics](../en/06-troubleshooting.md)

Esta guía te permite diagnosticar rápidamente cualquier código de error devuelto por la terminal o el SDK de Forge614 Engram, comprendiendo su causa exacta y cómo resolverlo sin arriesgar tus datos.

---

## 1. Principio Fundamental de Seguridad

> [!IMPORTANT]
> **Nunca borres tu base de datos ni tu configuración para "arreglar" un error.**
> Los errores en Forge614 Engram son mecanismos de protección activos. Cuando el sistema detecta un archivo alterado, permisos inseguros o una versión antigua, se niega a operar para **evitar corrupciones accidentales o pérdidas de datos**.

---

## 2. Catálogo Completo de Códigos de Error

| Código de Error | Mensaje Habitual | Causa Raíz Explicada | Solución Recomendada |
| :--- | :--- | :--- | :--- |
| `INVALID_INPUT` | *"El campo [campo] debe ser texto no vacío..."* o *"scope shared no acepta --project-id..."* | Se omitió una opción obligatoria, se pasaron textos vacíos, caracteres nulos (`\0`), números fuera de rango (`limit`), o se combinaron banderas incompatibles. | Revisa los argumentos del comando. Si operas un recuerdo compartido, no incluyas `--project-id`. Si operas un recuerdo de proyecto, indica su UUID con `--project-id`. |
| `PROJECT_NOT_FOUND` | *"Proyecto no encontrado."* | El `projectId` proporcionado no existe en la tabla `projects` de la base central `~/.forge614/engram.db`. | Ejecuta `forge614-engram project-list` para verificar los identificadores UUID de tus proyectos registrados. |
| `VERSION_CONFLICT` | *"La versión esperada no coincide. Lee el tema antes de actualizarlo."* | Se intentó actualizar un recuerdo temático pero el valor de `--expected-version` no es igual a la versión que la base tiene registrada actualmente. | Ejecuta `get` o `history` sobre ese recuerdo para comprobar su versión actual y actualiza indicando el número de versión correcto. |
| `REQUEST_CONFLICT` | *"La clave de petición ya corresponde a otro contenido."* | Se reutilizó un `--request-key` previo pero enviando un título, contenido, tema o tipo diferente. | Si deseas guardar una nueva revisión o nota distinta, utiliza una nueva clave (ej. `--request-key req-02`) o prescinde de ella. |
| `ARCHIVED` | *"Restaura el recuerdo antes de actualizar su tema."* | Se intentó actualizar un tema cuya memoria se encuentra actualmente en estado archivado. | Ejecuta `restore` sobre ese recuerdo antes de guardar la nueva versión temática. |
| `NOT_FOUND` | *"Recuerdo no encontrado en el alcance seleccionado."* | El identificador del recuerdo (`--id`) no existe en la base o no pertenece al proyecto/alcance indicado. | Comprueba si el recuerdo era de un proyecto específico o compartido, y verifica que el UUID no tenga errores tipográficos. |
| `CONFIG_NOT_FOUND` | *"Configuración global inválida o inaccesible..."* | No se encuentra el archivo `~/.forge614/.env` al intentar realizar una operación que requiere configuración previa. | Ejecuta `forge614-engram init` para crear la configuración global de forma segura. |
| `CONFIG_INVALID` | *"Configuración global inválida o inaccesible. Comprueba su formato, propietario y permisos..."* | El archivo `~/.forge614/.env` tiene permisos distintos a `0600`, la carpeta no es `0700`, pertenece a otro usuario, o su contenido no contiene exactamente las claves válidas. | Asegura que la carpeta `~/.forge614` tenga permisos `0700` (`chmod 700 ~/.forge614`) y el archivo `.env` tenga permisos `0600` (`chmod 600 ~/.forge614/.env`). |
| `LEGACY_CONFIG` | *"Se detectó configuración antigua por proyecto. No se modificó. Su conversión debe ser explícita..."* | Existe un directorio antiguo `projects/` dentro de `~/.forge614/` proveniente de diseños preliminares descartados. | El sistema no toca ni borra esa carpeta automáticamente. Si contiene datos que necesitas conservar, revísala y respalda su contenido antes de retirarla manualmente. |
| `MIGRATION_REQUIRED` | *"Formato anterior detectado. Conserva el archivo: no se modificó la base..."* | La base `engram.db` tiene esquema 1 o 2 (versión preliminar con esquemas antiguos). | El software actual requiere el esquema 3. Conserva tu archivo de respaldo; no se aplica migración destructiva automática sobre datos reales. |
| `DATABASE_MISSING` | *"Falta la base configurada. No se creó un reemplazo; conserva la configuración y recupera tu base."* | El archivo `.env` existe, pero el archivo `engram.db` no está presente en la carpeta. | Forge614 Engram jamás crea una base sustituta vacía de forma silenciosa para no perder tus datos. Restaura tu respaldo de `engram.db`. |
| `DATABASE_PATH_UNSAFE` | *"La base o un archivo auxiliar tiene un enlace, propietario o tipo no permitido. No se abrió SQLite."* | El archivo `engram.db` o sus archivos auxiliares (`-wal`, `-shm`) son enlaces simbólicos (*symlinks*), enlaces duros (*hard links*) o pertenecen a otro usuario. | Asegúrate de que los archivos sean archivos regulares pertenecientes a tu propio usuario del sistema operativo. |
| `DATABASE_SCHEMA` | *"La estructura no es compatible. No se modificó ni reparó la base."* | Las tablas, disparadores o índices de SQLite no coinciden exactamente con la definición canónica del esquema versión 3. | El sistema no repara ni modifica bases ajenas. Asegúrate de estar apuntando a la base legítima de Forge614 Engram. |
| `DATABASE_VERSION` | *"Base incompatible: no se puede abrir con esta versión."* | El `user_version` de SQLite es mayor o incompatible con la versión actual del software. | Actualiza el binario `forge614-engram` a la versión más reciente del código. |
| `DATABASE_OWNER` | *"La base contiene una estructura ajena; usa una base vacía y dedicada."* | El archivo SQLite contiene tablas creadas por otro software ajeno a Forge614. | Utiliza una base vacía y dedicada para Forge614. |
| `DATABASE_UNINITIALIZED`| *"La base no está inicializada. Conectar no crea tablas."* | Se intentó abrir la base en modo de solo lectura o sin permiso de creación antes de inicializarla. | Ejecuta `forge614-engram init` para crear las tablas correspondientes. |
| `STORAGE_ERROR` | *"No se pudo completar la operación. Comprueba permisos, configuración..."* | Fallo general de entrada/salida a nivel de sistema operativo (disco lleno, bloqueo permanente o error de hardware). | Verifica el espacio libre en el disco duro y los permisos generales del sistema. |

---

## 3. Escenarios Operativos Frecuentes

### 1. Se detectó `LEGACY_CONFIG` al ejecutar cualquier comando
- **Causa:** En tu carpeta `~/.forge614/` quedó una carpeta `projects/` de versiones de prueba previas.
- **Solución segura:** El sistema se detiene intencionadamente para que no pierdas información antigua. Revisa el contenido de `~/.forge614/projects/`. Si eran pruebas descartables, retira la carpeta; si necesitas los datos, cópialos a un lugar seguro antes de continuar.

### 2. La base de datos no existe y aparece `DATABASE_MISSING`
- **Causa:** Tienes el archivo `~/.forge614/.env` pero borraste o moviste `engram.db`.
- **Por qué no se crea sola:** Si el programa creara una base vacía automáticamente en silencio, un usuario cuya base fue renombrada por accidente creería que perdió todos sus recuerdos pasados. El error te avisa para que recuperes tu archivo `engram.db`.

### 3. La terminal tarda unos segundos en responder al escribir
- **Causa:** Hay otro proceso escribiendo en la base de datos simultáneamente.
- **Comportamiento:** SQLite serializa las escrituras. Gracias a `busy_timeout = 5000`, la terminal esperará pacientemente hasta 5 segundos a que el otro proceso termine antes de arrojar un error.
