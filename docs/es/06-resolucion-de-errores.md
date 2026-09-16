# 06. Resolución de Problemas y Catálogo de Errores

> **Etapa:** Etapa 1 — Memoria Local  
> **Estado:** Vigente y Activo  
> **Traducción hermana:** [06 (EN). Troubleshooting and Error Diagnostics](../en/06-troubleshooting.md)

Esta guía te ayuda a diagnosticar y solucionar cualquier error emitido por la terminal o el SDK de Forge614 Engram.

---

## 1. Catálogo Completo de Códigos de Error

Cuando una operación no puede completarse, el sistema devuelve un objeto JSON estructurado con el campo `code` y un mensaje descriptivo `error`.

> [!IMPORTANT]
> **Nunca borres tu base de datos para solucionar un error.** Los errores en Forge614 Engram son mecanismos de seguridad diseñados para proteger la integridad de tus recuerdos y evitar que pierdas datos por accidente. Cada error tiene una solución limpia y directa.

| Código de Error | Mensaje Habitual | Causa Raíz | Acción Recomendada |
| :--- | :--- | :--- | :--- |
| `INVALID_INPUT` | *"El campo [campo] debe ser texto no vacío..."* o *"Tipo no válido."* | Se omitió un argumento obligatorio, se pasó un texto vacío, se enviaron caracteres nulos (`\0`), un valor numérico fuera de rango (`limit` menor a 1 o mayor a 100), o un tipo no reconocido. | Verifica los argumentos de tu comando. Si usas `save`, confirma que `title` y `content` no estén vacíos. Si especificas `--expected-version`, asegúrate de incluir `--topic`. |
| `VERSION_CONFLICT` | *"La versión esperada no coincide. Lee el tema antes de actualizarlo."* | Se intentó actualizar un tema existente pero el valor de `--expected-version` no es igual a la versión que la base tiene actualmente registrada. Ocurre si la nota ya fue modificada por otro proceso. | Ejecuta `forge614-engram get` o `history` sobre ese recuerdo para consultar cuál es la versión más reciente en la base. Revisa qué cambios se hicieron y envía la nueva actualización indicando la versión correcta. |
| `REQUEST_CONFLICT` | *"La clave de petición ya corresponde a otro contenido."* | Se utilizó una clave `--request-key` que ya había sido usada previamente en este proyecto para guardar una nota con título, contenido, tema o tipo diferente. | Si estás intentando guardar una nota distinta o una nueva revisión, usa una clave de petición nueva (ej. `--request-key demo-v3`) o simplemente omite la opción `--request-key`. |
| `ARCHIVED` | *"Restaura el recuerdo antes de actualizar su tema."* | Se intentó guardar una nueva versión de un tema cuya memoria se encuentra actualmente archivada. | Ejecuta `forge614-engram restore --project <proyecto> --id <uuid>` para reactivar el recuerdo antes de guardar la nueva revisión. |
| `NOT_FOUND` | *"Recuerdo no encontrado en este proyecto."* | El identificador (`--id`) proporcionado no existe en la base de datos o pertenece a un proyecto diferente. | Confirma que el nombre del `--project` coincida exactamente con el proyecto donde se guardó la nota y verifica que el UUID no tenga errores tipográficos. |
| `DATABASE_VERSION` | *"Base incompatible: no se puede abrir con esta versión."* | El archivo de base de datos tiene una versión de esquema (`user_version > 1`) creada por una versión más moderna de Forge614 Engram. | Actualiza tu instalación de Forge614 Engram a la versión de software más reciente para que sea compatible con ese esquema. |
| `DATABASE_OWNER` | *"Esta base no pertenece a Forge614."* o *"La base ya contiene tablas ajenas..."* | Se intentó abrir un archivo SQLite que fue creado por otro programa diferente o que no tiene el identificador exclusivo de Forge614 (`application_id = 1177956660`). | Especifica una ruta de base de datos dedicada para Forge614 usando la opción `--db <ruta>`. Por defecto el sistema utiliza `~/.forge614/engram.db`. |
| `STORAGE_ERROR` | *"No se pudo completar la operación. Comprueba la ruta..."* | Error a nivel de sistema operativo: falta de permisos de escritura en la carpeta, disco lleno o problema físico de acceso a SQLite. | Comprueba que tengas permisos de lectura y escritura en la carpeta de usuario (`~/.forge614/`) y que haya espacio suficiente disponible en tu disco duro. |

---

## 2. Situaciones Operativas Frecuentes

### 1. ¿Qué pasó con mis recuerdos guardados en `.forge614/memory.sqlite`?
- **Explicación:** Las versiones iniciales guardaban la base en la carpeta donde se ejecutaba el comando. Ahora la base estándar se guarda en `~/.forge614/engram.db` para compartir recuerdos entre todas tus carpetas.
- **Solución:** Las bases anteriores no se borraron ni se modificaron. Para consultar tus datos viejos, simplemente usa la bandera `--db`:
  ```bash
  forge614-engram search --db ./ruta/antigua/.forge614/memory.sqlite --project demo --query SQLite
  ```

### 2. Dos procesos intentan escribir al mismo tiempo y la terminal tarda unos segundos en responder
- **¿Qué ocurre?** SQLite serializa las transacciones de escritura. Forge614 Engram tiene un tiempo de espera de hasta **5 segundos** (`busy_timeout = 5000ms`).
- **Solución:** La operación terminará con éxito automáticamente en cuanto el primer escritor libere el bloqueo. Si falla tras 5 segundos, comprueba que no haya un proceso interactivo o script colgado bloqueando la base.

### 3. Modifiqué un recuerdo y perdió su categoría de "decisión" o su prioridad
- **¿Por qué sucedió?** En la terminal (CLI), la opción `--type` toma el valor `fact` por defecto y `--pinned` toma `false` por defecto si no las escribes. La actualización reemplaza el registro completo.
- **Solución:** Al actualizar una nota importante, incluye siempre las banderas correspondientes:
  ```bash
  forge614-engram save --project demo --topic architecture/database --expected-version 2 --type decision --pinned true --title "..." --content "..."
  ```
