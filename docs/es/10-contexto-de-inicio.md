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
- **`project.source`** indica cómo se identificó el proyecto: `"file"` (por el `id` de su `.forge614/project.json`), `"path"` (por el vínculo de carpeta registrado en la base) o `"unbound"` (sin proyecto).
- **`project.notices`** aparece solo cuando hay algo que informar, como una lista de `{ "code", "message" }`: `PROJECT_FILE_CREATED` (un proyecto que ya estaba vinculado por ruta recibió su archivo), `PROJECT_REBOUND_FROM_FILE` (la carpeta se re-vinculó al proyecto que declara su archivo) `PROJECT_FILE_NOT_WRITTEN` (no se pudo escribir el archivo; la operación continúa) o `DATABASE_MIGRATED` (este comando actualizó la base por primera vez, porque el repositorio declara un grupo; `backup` indica dónde quedó el respaldo previo, si había datos, y las llamadas siguientes ya no avisan).

Cuando no se pueda resolver o vincular como proyecto, no falla: devuelve `"project": { "status": "unbound", "projectId": null, "context": null, "source": "unbound" }` y `"ecosystem": { "status": "none" }`. Cualquier directorio existente y legible es válido: `$HOME`, `/`, una carpeta sin Git, un repositorio Git sin vínculo y una carpeta vinculada.

## Por qué `format` se mantiene en 1

`ecosystem`, `project.source` y `project.notices` son **campos aditivos**: ningún campo existente cambió de nombre, tipo ni significado, de modo que un consumidor que ignore los campos desconocidos sigue funcionando sin cambios. Subir `format` habría obligado a todos los hosts, incluso a quienes no usan grupos, a reconocer una forma nueva. Un consumidor debe **ignorar los campos desconocidos** y tratar como ausente un bloque `ecosystem` que no entienda; Engines y Shell deben aceptarlo como opcional y saneado. Si algún día cambiara la forma de un campo existente, `format` subiría.

## Qué mantiene al día y qué nunca hace

El comando abre la base primero en modo de **solo lectura** y solo la reabre para escritura cuando tiene que registrar algo, porque mantiene sincronizadas la identidad del repositorio y la base local:

- Si el repositorio trae `.forge614/project.json` y su `id` no existe en la base local (por ejemplo, un clon en otra máquina), registra el proyecto —y su grupo— con ese `id`, sin preguntar.
- Si la base tenía esa carpeta vinculada a otro proyecto, **gana el archivo**: re-vincula, registra el evento `PROJECT_REBOUND_FROM_FILE` y no toca el archivo.
- Si un proyecto ya estaba vinculado solo por ruta, escribe su `.forge614/project.json` (en silencio; el resultado lo indica en `project.notices`).
- Si `forge614.node.json` declara `ecosystem`, o el archivo trae su sección `ecosystem`, vincula el grupo sin preguntar. Nada se infiere por nombres de carpeta, cercanía en disco ni remotos de Git.

Nunca crea recuerdos, sesiones ni bases, y nunca crea un proyecto para una carpeta sin vínculo ni archivo: esa carpeta es `unbound` y no se escribe nada en ella. Una memoria de proyecto con el mismo `topicKey` sustituye la compartida solo dentro de `project.context`; la sección superior `shared` no cambia. Los bloques `shared`, `ecosystem` y `project` no se deduplican entre sí.

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
- **`## Previous session (interrupted)`** (hasta 800 caracteres; solo con el esquema 11 y un proyecto vinculado): la sesión interrumpida más recientemente activa del proyecto, la misma que devuelve `previousInterrupted`. Dice `Session <id> was interrupted at <fecha ISO>; its last summary (<id del recuerdo> v<versión>):` seguido del resumen sin líneas en blanco, o `…; it saved no summary.` si no guardó ninguno. Si pasa de 800 caracteres se corta con `…`.
- **`## Index (titles only: open with memory_get)`** (el resto): solo títulos de los recuerdos activos sin fijar del tablero y del proyecto, alternando uno del tablero y uno del proyecto (el tablero primero; cada uno del más nuevo al más viejo). No incluye resúmenes de sesión ni recuerdos de la libreta sin fijar. Una carpeta sin vínculo no tiene índice: solo recibe el esencial de la libreta.

Cada lista se llena en orden y se detiene en la primera línea que no cabe; lo que queda fuera se cuenta en `omitted` y se encuentra con `memory_search`. Los textos fijos van en inglés; el contenido de los recuerdos va tal cual.

El formato 2 funciona en cualquier nivel de la base: no exige `intelligence-enable`. Solo con el esquema 11, la versión corta reemplaza al título en el esencial, los recuerdos marcados como reemplazados no aparecen, aparece `[verify]` y se incluye la sesión anterior; por debajo, el bloque sale de las mismas fuentes sin esos extras. Usa la misma apertura y la misma resolución del proyecto que el formato 1 (primero en solo lectura y, solo si debe registrar la identidad, en escritura), pero no incluye `notices`.

Sin `--format`, el comando sigue devolviendo el formato 1, con la salida de siempre. `--format` acepta solo `1` o `2`: otro valor responde `INVALID_INPUT` (`format debe ser 1 o 2.`) antes de abrir la base. Las versiones 2 y 3 del protocolo de memoria anuncian el comando sin `--format`, es decir, el formato 1 (la versión 1 no anuncia ninguno); la versión 4 (desde 1.7.0) anuncia el formato 2. Desde el SDK, el mismo bloque lo entrega `MemoryStore.startupBlock`.

## Errores seguros

`--directory` y `--json` son obligatorios. Fallan una ruta inexistente, una ruta que no es directorio o una ruta ilegible, un espacio no inicializado o cualquier otro fallo real, y también un `.forge614/project.json` inválido (`PROJECT_FILE_INVALID`: JSON corrupto, versión de esquema desconocida o campos desconocidos), que Engram nunca sobrescribe. El fallo deja stdout vacío, escribe JSON únicamente por stderr y termina con exit code 1: `{ "code": "…", "error": "…" }`, o `{ "schemaVersion": 1, "code": "…", "error": "…" }` para los códigos incorporados en 1.6.0. No imprime secretos, tokens, credenciales ni rutas crudas en el mensaje de error.

**Para los hosts:** un `.forge614/project.json` inválido es un error visible, no un contexto vacío: `startup-context` sale con código 1 y no devuelve ningún bloque (ni siquiera `shared`). Se repara corrigiendo el archivo o borrándolo; si se borra, Engram lo regenera en la siguiente ejecución cuando el proyecto ya está vinculado por ruta, y una carpeta sin vínculo queda `unbound`.

## Relación con memory protocol

`memory-protocol --json --protocol-version 1` no cambia. La versión 2 agrega `startupContext` para anunciar este comando a Engines y Shell, sin cambiar instrucciones ni lifecycle. La versión 3 anuncia además el ámbito `ecosystem` y describe este comando incluyendo el bloque de grupo. La versión 4 anuncia este comando con `--format 2`. Anunciarlo no demuestra que algún host ya lo consuma.
