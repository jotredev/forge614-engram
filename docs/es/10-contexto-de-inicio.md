# 10. Contexto de Inicio para Hosts

> **Estado:** disponible desde la versión 1.5.0.

Imagina que un host entrega al agente una carpeta de bienvenida antes de abrir la conversación. En lugar de esperar a que el modelo recuerde pedirla, `startup-context` entrega ese contexto inicial de forma segura y acotada.

## Comando y propósito

```bash
forge614-engram startup-context --directory /ruta/absoluta/al-repositorio --json
```

Es la **única interfaz pública** por la que Forge614 Engines o Forge614 Shell pueden leer memoria de Engram antes de iniciar una sesión de agente. Nunca deben abrir ni leer SQLite directamente. No requiere TTY, es idempotente y es apta para automatización, CI y hosts.

## Contrato de salida

En éxito escribe un único JSON en stdout:

```json
{
  "format": 1,
  "shared": { "pinned": [], "recent": [], "sessions": [], "truncated": false },
  "project": {
    "status": "bound",
    "projectId": "<uuid>",
    "context": { "pinned": [], "recent": [], "sessions": [], "truncated": false }
  }
}
```

`shared` y `project.context` usan la misma forma de `ContextResult` del comando `context` e incluyen vistas previas acotadas, no solo títulos. Si la ruta no está vinculada, no es un error: `project` es `{ "status": "unbound", "projectId": null, "context": null }` y se conserva el contexto compartido.

## Lectura estricta y límites

El comando usa SQLite en modo de solo lectura. Nunca crea proyectos, vínculos, recuerdos, sesiones, bases, archivos ni migraciones. Una memoria de proyecto con el mismo `topicKey` sustituye la compartida solo dentro de `project.context`; la sección superior `shared` no cambia.

Cada sección usa el límite propio de `context()` —16 384 bytes por defecto—, por lo que el payload combinado queda acotado. La operación funciona aun cuando el archivo de base está en modo de solo lectura.

## Errores seguros

`--directory` y `--json` son obligatorios, y la ruta debe ser válida. Una entrada inválida, un espacio no inicializado o cualquier fallo real escribe JSON `{ "code": "…", "error": "…" }` únicamente por stderr y termina con código `1`. No imprime secretos, tokens, credenciales ni la ruta solicitada en el mensaje de error.

## Relación con memory protocol

`memory-protocol --json --protocol-version 1` no cambia. La versión 2 agrega `startupContext` para anunciar este comando a Engines y Shell, sin cambiar instrucciones ni lifecycle. Anunciarlo no demuestra que algún host ya lo consuma.
