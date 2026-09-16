# Guía de Resolución de Problemas y Errores

> **Etapa:** Etapa 1 — Memoria Local  
> **Estado:** Vigente y Activo  
> **Traducción hermana:** [English Version](../en/06-06-resolucion-de-errores.md)

Esta guía te ayuda a diagnosticar y solucionar cualquier error emitido por la terminal o el SDK de Forge614 Engram.

---

## 1. Catálogo Completo de Códigos de Error

Cuando una operación no puede completarse, el sistema devuelve un objeto JSON estructurado con el campo `code` y un mensaje descriptivo `error`.

> [!IMPORTANT]
> **Nunca borres tu base de datos para solucionar un error.** Los errores en Forge614 Engram son mecanismos de seguridad diseñados para proteger la integridad de tus recuerdos y evitar que pierdas datos por accidente. Cada error tiene una solución limpia y directa.

| Código de Error | Mensaje Habitual | Causa Raíz | Acción Recomendada |
| :--- | :--- | :--- | :--- |
| `INVALID_INPUT` | *"El campo [campo] debe ser texto no vacío..."* o *"Tipo no válido."* | Se omitió un argumento obligatorio, se pasó un texto vacío, se enviaron caracteres nulos (`\0`), un valor numérico fuera de rango (`limit` menor a 1 o mayor a 100), o un tipo no reconocido. | Verifica los argumentos de tu comando. Si usas `save`, confirma que `title` y `content` no estén vacíos. Si especificas `--expected-version`, asegúrate de incluir `--topic`. |
| `VERSION_CONFLICT` | *"La versión esperada no coincide. Lee el tema antes de actualizarlo."* | Se intentó actualizar un tema existente pero el valor de `--expected-version` no es igual a la versión que la base tiene actualmente registrada. Ocurre si la nota ya fue modificada por otro proceso. | Ejecuta `bun run cli get` o `history` sobre ese recuerdo para consultar cuál es la versión más reciente en la base. Revisa qué cambios se hicieron y envía la nueva actualización indicando la versión correcta. |
| `REQUEST_CONFLICT` | *"La clave de petición ya corresponde a otro contenido."* | Se utilizó una clave `--request-key` que ya había sido usada previamente en este proyecto para guardar una nota con título, contenido, tema o tipo diferente. | Si estás intentando guardar una nota distinta o una nueva revisión, usa una clave de petición nueva (ej. `--request-key demo-v3`) o simplemente omite la opción `--request-key`. |
| `ARCHIVED` | *"Restaura el recuerdo antes de actualizar su tema."* | Se intentó guardar una nueva versión de un tema cuya memoria se encuentra actualmente archivada. | Ejecuta `bun run cli restore --project <proyecto> --id <uuid>` para reactivar el recuerdo antes de guardar la nueva revisión. |
| `NOT_FOUND` | *"Recuerdo no encontrado en este proyecto."* | El identificador (`--id`) proporcionado no existe en la base de datos o pertenece a un proyecto diferente. | Confirma que el nombre del `--project` coincida exactamente con el proyecto donde se guardó la nota y verifica que el UUID no tenga errores tipográficos. |
| `DATABASE_VERSION` | *"Base incompatible: no se puede abrir con esta versión."* | El archivo de base de datos tiene una versión de esquema (`user_version > 1`) creada por una versión más moderna de Forge614 Engram. | Actualiza tu instalación de Forge614 Engram a la versión de software más reciente para que sea compatible con ese esquema. |
| `DATABASE_OWNER` | *"Esta base no pertenece a Forge614."* o *"La base ya contiene tablas ajenas..."* | Se intentó abrir un archivo SQLite que fue creado por otro programa diferente o que no tiene el identificador exclusivo de Forge614 (`application_id = 1177956660`). | Especifica una ruta de base de datos dedicada para Forge614 usando la opción `--db <ruta>` (por ejemplo: `--db .forge614/memory.sqlite`). |
| `STORAGE_ERROR` | *"No se pudo completar la operación. Comprueba la ruta..."* | Error a nivel de sistema operativo: falta de permisos de escritura en la carpeta, disco lleno o problema físico de acceso a SQLite. | Comprueba que tengas permisos de lectura y escritura en la carpeta donde se ubica la base de datos y que haya espacio suficiente disponible en tu disco duro. |

---

## 2. Situaciones Operativas Frecuentes

### 1. Dos procesos intentan escribir al mismo tiempo y la terminal tarda en responder
- **¿Qué ocurre tras bambalinas?** SQLite utiliza un bloqueo de escritura exclusivo para garantizar la coherencia. Forge614 Engram está configurado con un tiempo de espera (`busy_timeout`) de **5 segundos**.
- **Solución:** Si un proceso tarda un instante en responder, generalmente terminará con éxito una vez que el primer escritor libere la base. Si la operación falla tras 5 segundos con error de almacenamiento, asegúrate de que no haya un proceso interactivo colgado reteniendo la base de datos.

### 2. Una consulta con palabras cortas no devuelve los resultados esperados
- **¿Qué ocurre?** Si tu búsqueda incluye palabras de menos de 3 caracteres (como `"UI"` o `"v1"`), el sistema utiliza el modo de coincidencia literal en minúsculas.
- **Solución:** Recuerda que en este modo todas las palabras deben aparecer literalmente en el título, contenido o tema. Verifica la ortografía exacta de las palabras en tu consulta.

### 3. Modifiqué un recuerdo y perdió su categoría de "decisión" o su prioridad
- **¿Por qué sucedió?** En la terminal (CLI), la opción `--type` toma el valor `fact` por defecto y `--pinned` toma `false` por defecto si no las escribes. La actualización reemplaza el contenido completo.
- **Solución:** Al actualizar una nota importante, incluye siempre las banderas correspondientes:
  ```bash
  bun run cli save --project demo --topic architecture/database --expected-version 2 --type decision --pinned true --title "..." --content "..."
  ```
