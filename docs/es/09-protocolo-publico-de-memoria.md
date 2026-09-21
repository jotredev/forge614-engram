# 09. Protocolo Público de Memoria

> **Estado:** disponible desde la release estable `v1.3.0`.

Imagina una tarjeta de instrucciones que cualquier asistente compatible puede leer antes de trabajar: no guarda una conversación completa, sino las reglas para usar el archivador común de forma consistente. Ese es el protocolo público de memoria de Forge614 Engram.

## Propósito y superficie pública

El contrato versionado identifica la memoria compartida y durable de una persona y sus proyectos. El SDK expone `memoryProtocol()` y el tipo `MemoryProtocol`; el transporte público no interactivo es:

```text
forge614-engram memory-protocol --json
```

La respuesta contiene un único objeto JSON con `id: "forge614-engram-memory"`, `version: 1`, instrucciones canónicas, ciclos `start`, `save`, `compact`, `resume` y `end`, reglas de `shared` y `project`, y `security.neverSave`.

La versión 1 permanece idéntica para compatibilidad. Los consumidores que soliciten `forge614-engram memory-protocol --json --protocol-version 2` reciben además `startupContext`, que anuncia `forge614-engram startup-context --directory <ruta-absoluta> --json`. Es una adición para hosts: no altera las instrucciones ni el ciclo de vida existentes.

El comando requiere obligatoriamente `--json`. No necesita TTY, no crea ni abre `~/.forge614/engram/`, no inicializa SQLite y no consulta proyectos, PostgreSQL ni datos de la persona. Sin `--json` o con flags desconocidos, escribe el error JSON estándar `{code,error}` a stderr y termina con código `1`.

## Ciclo de vida para asistentes compatibles

1. **Inicio.** Consultar memoria de proyecto y preferencias compartidas con `memory_context`. Si Engram no devuelve resultados, nunca inventar un recuerdo.
2. **Guardado.** Si la persona dice claramente “recuerda”, “guarda”, “ten presente”, “keep in mind” o un equivalente, guardar con `memory_save` sin pedir una segunda confirmación. También se guardan preferencias personales, de colaboración o documentación, decisiones, reglas, descubrimientos y resultados que sean durables; no cada mensaje ni transcripciones completas.
3. **Alcances.** Una preferencia entre asistentes usa `scope: "shared"` y un `globalIntent` verdadero (la explicación real de la intención global). El conocimiento de un repositorio usa alcance de proyecto. Un `topicKey` estable actualiza un tema existente en vez de duplicarlo; por ejemplo, `user/preference/favorite-color`.
4. **Compactación y reanudación.** Antes de compactar o descartar contexto, usar `memory_session_summary` con trabajo completado, decisiones, pendientes, riesgos y siguiente paso. Después, recuperar contexto con `memory_context` antes de continuar.
5. **Cierre.** Al acabar una sesión normal, guardar un resumen útil cuando hubo aprendizaje o trabajo durable y llamar a `memory_session_end`.

Si Engram falla, el asistente puede seguir trabajando, pero informa el fallo real. Un archivo privado alterno no equivale a memoria compartida de Forge614.

## Seguridad

Nunca se guardan en Engram ni se incluyen en logs, errores, títulos, contenido, `topicKey`, resúmenes o archivos alternos: contraseñas, tokens, claves privadas, credenciales ni cadenas de conexión que contengan credenciales.

## Límites aún no implementados

El protocolo no instala MCP, instrucciones, hooks ni plugins en Claude Code, Codex o Cursor. Forge614 Engines consumirá este JSON e instalará el protocolo con el mecanismo seguro de cada asistente; Forge614 Shell mostrará una vista previa y pedirá confirmación humana. Engram no configura asistentes directamente.

PostgreSQL sigue siendo una réplica opcional con sincronización explícita mediante `sync` o `sync-watch`. Esta entrega no agrega sincronización automática permanente hacia PostgreSQL ni una TUI.

## Verificación de la release `v1.3.0`

La entrega fue verificada con `bun test` (417 pass, 0 fail, 10 skip), `bun run typecheck`, `git diff --check` y las pruebas específicas de protocolo/SDK/CLI (38 pass, 0 fail).
