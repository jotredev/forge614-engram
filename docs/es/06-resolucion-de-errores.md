# 06. Resolución de Problemas y Catálogo de Errores

> **Etapa:** MCP Local, Menú TUI de Asistentes, Memoria Local y Sincronización PostgreSQL Opcional
> **Versiones de esta entrega:** Programa 0.5.0 | Formato de configuración 2 (local) / 3 (con sync) | Esquema SQLite 3 (local) / 4 (con sync) / 5 (asistentes y asociaciones locales)
> **Estado:** Vigente y Activo (Verificado con 191 pruebas en macOS con Bun 1.3.8)
> **Traducción hermana:** [06 (EN). Troubleshooting and Error Diagnostics](../en/06-troubleshooting.md)

Esta guía documenta el catálogo exhaustivo de códigos de error de Forge614 Engram, incluyendo los nuevos diagnósticos del protocolo MCP, el menú interactivo TUI, ganchos de asistentes y resolución de proyectos por Git, explicando su causa raíz y el procedimiento de recuperación recomendado.

---

## 1. Principio Fundamental de Seguridad

> [!IMPORTANT]
> **Nunca borres tu base de datos, tus tablas de SQLite ni tus puntos de control (*checkpoints*) para "arreglar" un error.**
> Los errores en Forge614 Engram son salvaguardas de seguridad activas. Cuando el sistema detecta una ambigüedad de carpetas, una interferencia externa en archivos de clientes o un conflicto de sincronización, se detiene intencionadamente para **proteger la integridad absoluta de tus datos y evitar pérdidas silenciosas**.

---

## 2. Catálogo Completo de Códigos de Error

| Código de Error | Mensaje Habitual | Causa Raíz Explicada | Solución Recomendada |
| :--- | :--- | :--- | :--- |
| `INTERACTIVE_REQUIRED` | *"tui necesita una terminal interactiva..."* o *"setup necesita una terminal interactiva..."* | Se invocó `tui` o `setup` desde un script, tubería (`\|`) o entorno desatendido (`isTTY` falso o sin *raw mode*). | Ejecuta el comando directamente en tu terminal. Para auditorías desatendidas en scripts, utiliza `forge614-engram assistant-list`. |
| `PROJECT_IDENTITY_UNAVAILABLE`| *"No se pudo determinar de forma segura la identidad Git del proyecto."* | Git no está instalado, no se encuentra en el PATH, o la invocación de `git rev-parse` falló. | Instala Git (`git --version`) y asegúrate de que esté accesible en el PATH de la terminal. |
| `PROJECT_DIRECTORY_REQUIRED` | *"Una carpeta sin Git requiere directory explícito o una raíz MCP única."* o *"La carpeta del ejecutable no se usa..."* | Se invocó una herramienta MCP en una carpeta sin Git sin especificar la ruta, o se intentó usar el directorio del binario como proyecto. | Especifica el parámetro `directory` en la llamada a la herramienta MCP o vincula la carpeta previamente con `project-bind`. |
| `PROJECT_NOT_BOUND` | *"La carpeta todavía no está vinculada; guardar puede crearla o project-bind puede recuperarla."* | Se intentó buscar (`memory_search`), obtener (`memory_get`) o ver historial (`memory_history`) en una carpeta no registrada antes de guardar el primer recuerdo. | Guarda una primera nota técnica con `memory_save` (que creará la vinculación automáticamente) o asóciala con `project-bind`. |
| `PROJECT_BINDING_REQUIRED` | *"Existe un proyecto con el mismo nombre..."* o *"Hay proyectos cuyas carpetas registradas no están disponibles..."* | Existe ambigüedad: o bien hay otro proyecto con el mismo nombre, o bien alguna carpeta registrada en `project_bindings` ya no existe en el disco (carpeta movida o disco desmontado). | Consulta tus proyectos con `forge614-engram project-list` y asocia la carpeta explícitamente mediante `forge614-engram project-bind --directory /ruta --project-id <UUID>`. |
| `PROJECT_BINDING_CONFLICT` | *"La carpeta ya está vinculada a otro proyecto."* | Se intentó vincular con `project-bind` una carpeta que ya tiene una asociación registrada hacia otro `projectId`. | Si deseas mover o reasignar la carpeta, verifica los proyectos registrados con `project-list`. |
| `AMBIGUOUS_PROJECT` | *"Varias raíces MCP requieren indicar directory explícitamente."* | El cliente de IA tiene múltiples espacios de trabajo abiertos simultáneamente y no especificó el parámetro `directory`. | Pasa el argumento `directory` explícito en la llamada a la herramienta MCP correspondiente. |
| `SHARED_INTENT_REQUIRED` | *"scope shared requiere explicar la intención global explícita del usuario."* | El asistente intentó llamar a `memory_save` con `scope: "shared"` sin incluir el campo explicativo `globalIntent`. | Proporciona una explicación detallada en `globalIntent` justificando por qué la nota aplica a todos los proyectos. |
| `INSTALLATION_REQUIRED` | *"Requisito: ejecuta forge614-engram tui con el binario instalado..."* | Se intentó ejecutar la autoprueba en `tui` ejecutando desde el código fuente con Bun sin tener instalado el binario compilado en `$HOME/.local/bin/`. | Compila e instala el ejecutable oficial ejecutando `bash scripts/install.sh` y repite la prueba con el binario instalado. |
| `TIMED_OUT` | Autoprueba del servidor reportada como fallida por límite de tiempo. | La autoprueba del servidor MCP superó el plazo máximo estricto de 5 segundos para inicializar, listar herramientas y cerrarse. | Verifica que tu sistema no tenga una sobrecarga extrema de CPU y que el binario instalado tenga permisos de ejecución (`0755`). |
| `MCP_FAILED` | Autoprueba del servidor reportada como fallida. | El servidor MCP falló al responder al apretón de manos (*handshake*) o no expuso las 5 herramientas esperadas. | Comprueba que la base de datos tenga el Esquema 5 habilitado mediante `forge614-engram integration-enable`. |
| `CANCELLED` | Autoprueba cancelada. | El usuario presionó la tecla `Escape` durante la ejecución de la autoprueba. | La cancelación es limpia y segura; conserva la selección de clientes previa. |
| `PUBLISHED_UNVERIFIED` | *"Publicado sin verificar: [ruta]"* | Se aplicó la configuración al archivo del cliente, pero la verificación posterior de bytes falló debido a modificaciones concurrentes de otro proceso. | Engram retiene la copia de seguridad `.bak`. Cierra el editor o cliente de desarrollo y vuelve a aplicar la configuración desde `tui`. |
| `AMBIGUOUS` | *"Both OpenCode JSON and JSONC configs exist..."* | En OpenCode existen archivos simultáneos `.json` y `.jsonc`, o múltiples fuentes de configuración activas sin selección explícita. | Selecciona el archivo de configuración deseado de forma explícita o retira la configuración duplicada en OpenCode. |
| `UNSUPPORTED_PLATFORM` | *"Assistant configuration currently supports macOS and Linux."* | Se ejecutó la configuración de asistentes en un sistema operativo no compatible. | Utiliza macOS o Linux para la configuración de asistentes de desarrollo. |
| `INVALID_INPUT` | *"El campo [campo] debe ser texto no vacío..."* | Opciones vacías, caracteres nulos (`\0`), números fuera de rango (`limit`) o argumentos incompatibles. | Revisa la sintaxis en `forge614-engram help`. En `shared` no pases `--project-id`; en `project` proporciona su UUID. |
| `PROJECT_NOT_FOUND` | *"Proyecto no encontrado en esta base."* | El `projectId` no existe en la tabla `projects` de `~/.forge614/engram.db`. | Ejecuta `forge614-engram project-list` para verificar los UUIDs de tus proyectos registrados. |
| `VERSION_CONFLICT` | *"La versión esperada no coincide. Lee el tema antes de actualizarlo."* | El valor de `--expected-version` no coincide con la versión activa actual en la base de datos. | Consulta la versión actual con `get` o `history` y actualiza indicando la versión correcta. |
| `REQUEST_CONFLICT` | *"La clave de petición ya corresponde a otro contenido."* | Se reutilizó un `--request-key` previo con un contenido, título o tema diferente. | Si buscas registrar una nueva nota o revisión, utiliza una nueva clave (ej. `--request-key req-02`) o prescinde de ella. |
| `ARCHIVED` | *"Restaura el recuerdo antes de actualizar su tema."* | Se intentó actualizar un tema cuya memoria está en estado archivado. | Ejecuta `restore` sobre ese recuerdo antes de guardar la nueva versión temática. |
| `NOT_FOUND` | *"Recuerdo no encontrado en el alcance seleccionado."* | El ID del recuerdo no existe en la base o no pertenece al proyecto/alcance indicado. | Verifica si el recuerdo era de proyecto o compartido, y revisa que el UUID esté completo y correcto. |
| `CONFIG_BUSY` | *"Otra configuración está en curso. No se reemplazó el archivo."* | Existe el cerrojo `~/.forge614/.config-lock` porque otro proceso está ejecutando `setup` o `tui`. | Espera a que termine. Si fue un cierre abrupto anterior, retira manualmente el archivo `.config-lock`. |
| `SYNC_DISABLED` | *"Sincronización PostgreSQL desactivada. Ejecuta setup para configurarla."* | Se ejecutó `sync` o `sync-watch` pero `.env` no tiene `POSTGRES_URL` (formato 2). | Ejecuta `forge614-engram setup` y elige `Sí, configurar PostgreSQL` para activar la réplica. |
| `SYNC_CONFLICT` | *"SYNC_CONFLICT: sincronización detenida; se conservan los datos locales y remotos."* | Modificaciones incompatibles sobre una misma entidad entre local y remoto. | Detiene la ronda para proteger los datos. No hay resolución automática en esta versión; no borres tablas. |
| `SYNC_TOO_LARGE` | *"SYNC_TOO_LARGE: sincronización detenida; se conservan los datos..."* | La instantánea sobrepasa el límite estricto de 8 MiB (`8,388,608 bytes`). | Archiva datos obsoletos o divide tu espacio de trabajo. |
| `POSTGRES_URL` | *"POSTGRES_URL: conexión inválida..."* | Protocolo inválido o intento de `sslmode=disable` fuera de `127.0.0.1`/`localhost`. | Conexiones remotas exigen TLS verificado de manera estricta. |
| `POSTGRES_UNAVAILABLE` | *"PostgreSQL no disponible o sin permisos..."* | Servidor PostgreSQL inaccesible o credenciales incorrectas. | Los datos locales en SQLite continúan operativos al 100%. Comprueba tu red y credenciales. |

---

## 3. Escenarios Operativos y de Recuperación

### 1. Los ganchos de Codex no se disparan tras configurarlo con `tui`
- **Causa:** Codex cuenta con una política de seguridad nativa donde los ganchos nuevos deben ser revisados y aprobados explícitamente por el usuario antes de permitir su ejecución.
- **Solución:** Abre Codex en tu terminal o interfaz y ejecuta el comando `/hooks`. Revisa los ganchos asociados a Forge614 Engram y marca la opción de confiar en ellos (*trust*).

### 2. Aparece `PROJECT_BINDING_REQUIRED` al trabajar en una carpeta nueva
- **Causa:** El sistema detectó que alguna carpeta que tenías registrada previamente ya no se encuentra en el disco (por ejemplo, renombraste la carpeta o desconectaste un disco externo). Engram bloquea preventivamente para no crear un proyecto huérfano por error.
- **Solución:**
  1. Ejecuta `forge614-engram project-list` para identificar el UUID de tu proyecto.
  2. Ejecuta `forge614-engram project-bind --directory /ruta/actual --project-id <UUID>`.
  3. Si la carpeta es verdaderamente un proyecto nuevo, créalo primero con `forge614-engram project-create --name "Nombre"` y luego vincúlalo con `project-bind`.

### 3. La autoprueba del servidor MCP falla con `INSTALLATION_REQUIRED`
- **Causa:** Ejecutaste `bun src/cli.ts tui` directamente desde el repositorio de desarrollo sin haber compilado e instalado el ejecutable autónomo. Por seguridad, Engram jamás registra a Bun como binario de producción en las configuraciones de los clientes.
- **Solución:** Ejecuta `bash scripts/install.sh --force` para compilar y publicar el binario en `$HOME/.local/bin/forge614-engram`. Luego abre el menú ejecutando `forge614-engram tui`.

### 4. Se produce `PUBLISHED_UNVERIFIED` al aplicar configuraciones
- **Causa:** El archivo de configuración de Claude Code, Cursor o Codex fue modificado por el propio editor o por un proceso en segundo plano en el mismo instante en que Engram escribía los cambios.
- **Solución:** Engram conserva intacta la copia de respaldo previa con sufijo UUID. Cierra la aplicación del cliente para evitar escrituras concurrentes y vuelve a ejecutar `forge614-engram tui` para aplicar la configuración limpiamente.
