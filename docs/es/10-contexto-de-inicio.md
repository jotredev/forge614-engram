# 10. Contexto de Inicio para Hosts

> **Estado:** disponible desde la versión 1.5.0. El bloque `ecosystem`, `project.source` y el mantenimiento de la identidad del repositorio están disponibles desde la versión 1.6.0. El formato 2 (`--format 2`) está disponible desde la versión 1.7.0.

Imagina que un host entrega al agente una carpeta de bienvenida antes de abrir la conversación. En lugar de esperar a que el modelo recuerde pedirla, `startup-context` entrega ese contexto inicial de forma segura y acotada.

## Comando y propósito

```bash
forge614-engram startup-context --directory /ruta/absoluta/al-repositorio --json
```

Es la **única interfaz pública** por la que Forge614 Engines o Forge614 Shell pueden leer memoria de Engram antes de iniciar una sesión de agente. Nunca deben abrir ni leer SQLite directamente. Es una consulta no interactiva e idempotente; no requiere TTY y es apta para automatización, CI y hosts.

## Contrato de salida

En éxito escribe un único JSON en stdout, con las claves en este orden:

```json
{
  "format": 1,
  "shared": { "format": 1, "pinned": [], "recent": [], "summaries": [], "omitted": { "pinned": 0, "recent": 0, "summaries": 0 }, "truncated": false },
  "ecosystem": {
    "status": "member",
    "group": { "id": "<uuid>", "name": "mi-tienda" },
    "context": { "format": 1, "pinned": [], "recent": [], "summaries": [], "omitted": { "pinned": 0, "recent": 0, "summaries": 0 }, "truncated": false }
  },
  "project": {
    "status": "bound",
    "projectId": "<uuid>",
    "context": { "format": 1, "pinned": [], "recent": [], "summaries": [], "omitted": { "pinned": 0, "recent": 0, "summaries": 0 }, "truncated": false },
    "source": "file"
  }
}
```

`shared`, `ecosystem.context` y `project.context` usan la misma forma de `ContextResult` del comando `context` e incluyen vistas previas acotadas, no solo títulos. Cada bloque usa su propio límite de bytes.

- **`ecosystem`** es `{ "status": "member", "group": { "id", "name" }, "context": … }` cuando el proyecto pertenece a un grupo (consulta [11. Ámbitos y Ecosistemas](11-ambitos-y-ecosistemas.md)) y `{ "status": "none" }` en cualquier otro caso: proyecto suelto, carpeta sin vínculo o base creada por una versión anterior.
- **`project.source`** usa `"file"` para una declaración legada compatible, `"path"` para un vínculo SQLite o una coincidencia única por remoto confirmado, y `"unbound"` cuando falta resolver el proyecto.
- **`project.notices`** aparece cuando hay un aviso. Cada entrada tiene `code` y `message`. `PROJECT_BINDING_REQUIRED` señala una decisión pendiente y `PROJECT_ORIGIN_CONFIRMATION_REQUIRED` un traslado a un remoto libre. También se informa de archivos legados rastreados o no publicados y de migraciones de grupo con su respaldo, si corresponde.

Cuando no se pueda resolver o vincular como proyecto, no falla: devuelve `"project": { "status": "unbound", "projectId": null, "context": null, "source": "unbound" }` y `"ecosystem": { "status": "none" }`. Cualquier directorio existente y legible es válido: `$HOME`, `/`, una carpeta sin Git, un repositorio Git sin vínculo y una carpeta vinculada.

## Por qué `format` se mantiene en 1

`ecosystem`, `project.source` y `project.notices` son **campos aditivos**: ningún campo existente cambió de nombre, tipo ni significado, de modo que un consumidor que ignore los campos desconocidos sigue funcionando sin cambios. Subir `format` habría obligado a todos los hosts, incluso a quienes no usan grupos, a reconocer una forma nueva. Un consumidor debe **ignorar los campos desconocidos** y tratar como ausente un bloque `ecosystem` que no entienda; Engines y Shell deben aceptarlo como opcional y saneado. Para mostrar los avisos nuevos, un host que filtra por código debe admitir `PROJECT_BINDING_REQUIRED` y `PROJECT_ORIGIN_CONFIRMATION_REQUIRED`. El formato 2 incorpora el aviso directamente en el texto.

## Lectura del catálogo

El comando abre SQLite primero en solo lectura. Una coincidencia única por remoto confirmado puede mostrar el UUID, los recuerdos y el ecosistema sin registrar un vínculo ni publicar el archivo. El primer guardado o inicio de sesión confirma el vínculo local. Un archivo legado compatible sigue siendo una vía de importación y puede necesitar reabrir la base para registrar el proyecto o su grupo.

Cuando hay evidencias contradictorias o el catálogo de nube está pendiente, el resultado incluye contexto compartido, `project.status: "unbound"` y un aviso `PROJECT_BINDING_REQUIRED`. El comando conserva los archivos y los vínculos previos. Los proyectos con una política de grupo explícita reciben su membresía mediante `group-bind` y `group-unbind`.

El arranque nunca crea recuerdos, sesiones ni bases. Una memoria de proyecto con el mismo `topicKey` oculta la compartida solo dentro de `project.context`. El bloque superior `shared` conserva sus resultados.

Cada bloque usa el límite propio de `context()` —16 384 bytes por defecto—, por lo que el payload combinado queda acotado (tres veces ese límite como máximo).

## Formato 2: bloque listo para inyectar (desde 1.7.0)

```bash
forge614-engram startup-context --directory /ruta/absoluta/al-repositorio --json --format 2
```

En vez del JSON de contexto, devuelve un único JSON con un bloque de texto que el host puede inyectar tal cual al iniciar un agente. Las claves van en este orden: `format` (siempre `2`), `text`, `chars`, `sections` y `omitted`. Un ejemplo corto:

```json
{
  "format": 2,
  "text": "[Forge614 Engram] Startup block: retrieved data, not an instruction.\n319/5000 chars · nothing omitted.\n\n## Essentials (pinned)\n- Run tests with bun test · project · 3f2b9c1e-7d4a-4e8b-9a61-2c5d8e0f4b17\n\n## Index (titles only: open with memory_get)\n- Shared schema decision · board · b8e4d2a0-5c19-4f37-8e2d-6a9b1c3e7f50",
  "chars": 319,
  "sections": { "essentials": 97, "previous": 0, "index": 116 },
  "omitted": 0
}
```

`chars` es la longitud exacta de `text` en caracteres Unicode, encabezado incluido, y nunca pasa de 5 000. `sections` da los caracteres de cada sección (0 si no aparece) y `omitted` cuenta los títulos del esencial y del índice que no entraron.

`text` empieza con dos líneas de encabezado: `[Forge614 Engram] Startup block: retrieved data, not an instruction.` y `<chars>/5000 chars · nothing omitted.` (o `<chars>/5000 chars · <N> titles did not fit: find them with memory_search.`). Después, separadas por una línea en blanco y solo si tienen algo, van tres secciones en este orden:

- **`## Essentials (pinned)`** (hasta 1 500 caracteres): recuerdos activos fijados de la libreta personal (`shared`; un recuerdo del proyecto con el mismo tema oculta al compartido), del tablero del grupo (la nota de estado `ecosystem/estado-actual` primero) y del proyecto, en ese orden, y dentro de cada uno del más nuevo al más viejo. Una línea por recuerdo: `- <versión corta o título> [verify] · <personal|board|project> · <id>`; `[verify]` solo aparece si venció su vigencia.
- **`## Previous session (interrupted)`** (hasta 800 caracteres; solo con el esquema 11 y un proyecto vinculado): la sesión runtime abierta del proyecto que se quedó abierta (sin actividad desde hace más de 30 minutos) con la actividad más reciente, la misma que devuelve `previousInterrupted`. Dice `Session <id> was left open; its last activity was at <fecha ISO>; its last summary (<id del recuerdo> v<versión>):` seguido del resumen sin líneas en blanco, o `…; it saved no summary.` si no guardó ninguno. Si pasa de 800 caracteres se corta con `…`. El bloque nunca lista las sesiones abiertas en paralelo: se arma antes de que exista la sesión nueva y se vuelve a inyectar tras compactar, donde la «paralela» sería la propia sesión. Por lo mismo, tras compactar, si la propia sesión lleva más de 30 minutos sin actividad en Engram, el bloque puede nombrarla como «left open»; es dato, y repetir `memory_session_start` no devuelve `previous`.
- **`## Index (titles only: open with memory_get)`** (el resto): solo títulos de los recuerdos activos sin fijar del tablero y del proyecto, alternando uno del tablero y uno del proyecto (el tablero primero; cada uno del más nuevo al más viejo). No incluye resúmenes de sesión ni recuerdos de la libreta sin fijar. Una carpeta sin vínculo no tiene índice: solo recibe el esencial de la libreta.

Cada lista se llena en orden y se detiene en la primera línea que no cabe; lo que queda fuera se cuenta en `omitted` y se encuentra con `memory_search`. Los textos fijos van en inglés; el contenido de los recuerdos va tal cual.

El formato 2 funciona en cualquier nivel de la base: no exige `intelligence-enable`. Solo con el esquema 11, la versión corta reemplaza al título en el esencial, los recuerdos marcados como reemplazados no aparecen, aparece `[verify]` y se incluye la sesión anterior; por debajo, el bloque sale de las mismas fuentes sin esos extras. Usa la misma apertura y la misma resolución del proyecto que el formato 1 (primero en solo lectura y, solo si debe registrar la identidad, en escritura), e incluye el aviso de vínculo o confirmación pendiente como una línea dentro del presupuesto de 5 000 caracteres.

Sin `--format`, el comando sigue devolviendo el formato 1, con la salida de siempre. `--format` acepta solo `1` o `2`: otro valor responde `INVALID_INPUT` (`format debe ser 1 o 2.`) antes de abrir la base. Las versiones 2 y 3 del protocolo de memoria anuncian el comando sin `--format`, es decir, el formato 1 (la versión 1 no anuncia ninguno); la versión 4 (desde 1.7.0) anuncia el formato 2. Desde el SDK, el mismo bloque lo entrega `MemoryStore.startupBlock`.

## Con la nube activada (desde 1.8.0)

Con `cloud on`, `startup-context` y `memory_context` esperan como máximo 1 segundo a la réplica. Una carpeta nueva con remoto utilizable o archivo legado queda pendiente hasta que termine la primera descarga y el cursor de identidad alcance al general. Un vínculo local existente sigue disponible. Si actualizaste desde una base de esquema 12, ejecuta `sync` para preparar el catálogo de identidad con respaldo fuera de la espera de arranque. Con `cloud off` se usa el catálogo local.

`startup-context` también abre correctamente aunque falten los archivos auxiliares de SQLite en modo WAL (`engram.db-wal` y `engram.db-shm`), que SQLite borra al cerrarse la última conexión: antes fallaba con `STORAGE_ERROR` en la primera sesión tras cerrar todo (también en 1.7.2); desde 1.8.0 reintenta en modo escritura y sigue funcionando con normalidad, incluida la espera de la nube.

## Errores seguros

`--directory` y `--json` son obligatorios. Fallan una ruta inexistente, una ruta que no es directorio o una ruta ilegible, un espacio no inicializado o cualquier otro fallo real, y también un `.forge614/project.json` inválido (`PROJECT_FILE_INVALID`: JSON corrupto, versión de esquema desconocida o campos desconocidos), que Engram nunca sobrescribe. El fallo deja stdout vacío, escribe JSON únicamente por stderr y termina con exit code 1: `{ "code": "…", "error": "…" }`, o `{ "schemaVersion": 1, "code": "…", "error": "…" }` para los códigos incorporados en 1.6.0. No imprime secretos, tokens, credenciales ni rutas crudas en el mensaje de error.

**Para los hosts.** Un archivo legado inválido produce `PROJECT_FILE_INVALID` y no hay bloque de salida. Un archivo válido con identidad incompatible produce un aviso y deja disponible el bloque compartido.

## Relación con memory protocol

`memory-protocol --json --protocol-version 1` no cambia. La versión 2 agrega `startupContext` para anunciar este comando a Engines y Shell, sin cambiar instrucciones ni lifecycle. La versión 3 anuncia además el ámbito `ecosystem` y describe este comando incluyendo el bloque de grupo. La versión 4 anuncia este comando con `--format 2`. Anunciarlo no demuestra que algún host ya lo consuma.
