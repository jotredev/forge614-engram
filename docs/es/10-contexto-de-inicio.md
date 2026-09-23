# 10. Contexto de Inicio para Hosts

> **Estado:** disponible desde la versión 1.5.0. El bloque `ecosystem`, `project.source` y el mantenimiento de la identidad del repositorio están disponibles desde la versión 1.6.0.

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
- **`project.notices`** aparece solo cuando hay algo que informar, como una lista de `{ "code", "message" }`: `PROJECT_FILE_CREATED` (un proyecto que ya estaba vinculado por ruta recibió su archivo), `PROJECT_REBOUND_FROM_FILE` (la carpeta se re-vinculó al proyecto que declara su archivo) o `PROJECT_FILE_NOT_WRITTEN` (no se pudo escribir el archivo; la operación continúa).

Cuando no se pueda resolver o vincular como proyecto, no falla: devuelve `"project": { "status": "unbound", "projectId": null, "context": null, "source": "unbound" }` y `"ecosystem": { "status": "none" }`. Cualquier directorio existente y legible es válido: `$HOME`, `/`, una carpeta sin Git, un repositorio Git sin vínculo y una carpeta vinculada.

## Por qué `format` se mantiene en 1

`ecosystem`, `project.source` y `project.notices` son **campos aditivos**: ningún campo existente cambió de nombre, tipo ni significado, de modo que un consumidor que ignore los campos desconocidos sigue funcionando sin cambios. Subir `format` habría obligado a todos los hosts, incluso a quienes no usan grupos, a reconocer una forma nueva. Un consumidor debe **ignorar los campos desconocidos** y tratar como ausente un bloque `ecosystem` que no entienda; Engines y Shell deben aceptarlo como opcional y saneado. Si algún día cambiara la forma de un campo existente, `format` subiría.

## Qué mantiene al día y qué nunca hace

El comando abre la base en modo **escritura** porque mantiene sincronizadas la identidad del repositorio y la base local:

- Si el repositorio trae `.forge614/project.json` y su `id` no existe en la base local (por ejemplo, un clon en otra máquina), registra el proyecto —y su grupo— con ese `id`, sin preguntar.
- Si la base tenía esa carpeta vinculada a otro proyecto, **gana el archivo**: re-vincula, registra el evento `PROJECT_REBOUND_FROM_FILE` y no toca el archivo.
- Si un proyecto ya estaba vinculado solo por ruta, escribe su `.forge614/project.json` (en silencio; el resultado lo indica en `project.notices`).
- Si `forge614.node.json` declara `ecosystem`, o el archivo trae su sección `ecosystem`, vincula el grupo sin preguntar. Nada se infiere por nombres de carpeta, cercanía en disco ni remotos de Git.

Nunca crea recuerdos, sesiones ni bases, y nunca crea un proyecto para una carpeta sin vínculo ni archivo: esa carpeta es `unbound` y no se escribe nada en ella. Una memoria de proyecto con el mismo `topicKey` sustituye la compartida solo dentro de `project.context`; la sección superior `shared` no cambia. Los bloques `shared`, `ecosystem` y `project` no se deduplican entre sí.

Cada bloque usa el límite propio de `context()` —16 384 bytes por defecto—, por lo que el payload combinado queda acotado (tres veces ese límite como máximo).

## Errores seguros

`--directory` y `--json` son obligatorios. Fallan una ruta inexistente, una ruta que no es directorio o una ruta ilegible, un espacio no inicializado o cualquier otro fallo real, y también un `.forge614/project.json` inválido (`PROJECT_FILE_INVALID`: JSON corrupto, versión de esquema desconocida o campos desconocidos), que Engram nunca sobrescribe. El fallo deja stdout vacío, escribe JSON únicamente por stderr y termina con exit code 1: `{ "code": "…", "error": "…" }`, o `{ "schemaVersion": 1, "code": "…", "error": "…" }` para los códigos incorporados en 1.6.0. No imprime secretos, tokens, credenciales ni rutas crudas en el mensaje de error.

## Relación con memory protocol

`memory-protocol --json --protocol-version 1` no cambia. La versión 2 agrega `startupContext` para anunciar este comando a Engines y Shell, sin cambiar instrucciones ni lifecycle. La versión 3 anuncia además el ámbito `ecosystem` y describe este comando incluyendo el bloque de grupo. Anunciarlo no demuestra que algún host ya lo consuma.
