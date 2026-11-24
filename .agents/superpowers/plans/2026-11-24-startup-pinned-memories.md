# Fijadas del proyecto al abrir una sesión

> Para ejecutar el plan, usar `superpowers:executing-plans` o `superpowers:subagent-driven-development`. Cada tarea comprueba primero la regresión y luego la corrección.

**Objetivo** Garantizar espacio para las fijadas del proyecto y que las demás puedan recuperarse al iniciar o retomar una sesión.

**Arquitectura** La capa SQLite selecciona las fijadas por dueño y las ordena dentro de su ámbito. El módulo de arranque calcula presupuestos sobre la representación común, que también se usa para consultar y avisar al guardar. Los manejadores MCP enlazan estas operaciones con la carpeta resuelta y conservan los contratos de las llamadas existentes.

**Tecnología** TypeScript, Bun, SQLite y MCP.

**Diseño** [Memorias fijadas al abrir una sesión](../specs/2026-11-24-startup-pinned-memories-design.md).

## Restricciones

Formato 2 con 5000 caracteres Unicode, `Essentials` de hasta 1500 y reservas 50/25/25 con préstamo de espacio. Prioridad proyecto, tablero y personal. Mostrar hasta 120 caracteres del título o versión corta. Respetar dueños, datos históricos, sesión e idempotencia. El manual v4 conserva sus topes de 2500 y 2000 caracteres.

## Casos de revisión

- Más de 200 fijadas personales antes de la primera fijada del proyecto.
- Emojis en los límites de `short`, `Essentials` y páginas en bytes.
- Fijadas compartidas ocultas por un tema de proyecto y tablero de otro grupo.
- Un reintento de resumen o fijación con otro conjunto de fijadas activas.
- Un aviso de vínculo junto con un resumen anterior al llenar el arranque.

## 1. Reservas, orden y omisiones en el arranque

Archivos `src/modules/search/startup{,.test}.ts`, `src/modules/search/index.ts`, `src/infrastructure/sqlite/{pinned,startup,startup.test}.ts`.

- [x] Agregar una regresión SQLite con 220 personales, dos fijadas de proyecto y otras del tablero. Comprobar orden y presencia de los tres ámbitos. En el render, comprobar el límite de caracteres, el recorte Unicode y los conteos e IDs omitidos.
- [x] Ver el fallo con `bun test src/modules/search/startup.test.ts src/infrastructure/sqlite/startup.test.ts`.
- [x] Exponer `pinnedText`, `pinnedReservedCount` y los tipos de ámbito y conteo del módulo de arranque. Hacer `readPinned(db, view, limit, offset?, now?)` en SQLite con selección por dueño, estado y sustitución. El arranque lee candidatos y conteo por ámbito y agrega `pinnedOmitted` solo si hubo omisiones. Compartir medición del texto con `pinnedReservedCount`.
- [x] Repetir las pruebas y `bun run typecheck`. Registrar la tarea.

## 2. Consulta paginada y aviso al fijar

Archivos `src/interfaces/mcp/{schemas,sessions-tools,memory-tools}.ts`, las pruebas MCP correspondientes, `src/app/memory-store.ts`, `src/infrastructure/sqlite/{pinned,writes}.ts` y `src/modules/{search,memory,sessions}`.

- [x] Probar `memory_context` con 26 fijadas, `maxBytes: 1024` y cursor hasta agotar. Probar visibilidad por ámbito y carpeta sin vínculo. Probar aviso tras rebasar la reserva, reintento del guardado y límites de 120 puntos Unicode para una fijada y 300 para una versión corta ordinaria.
- [x] Ver los fallos con `bun test src/interfaces/mcp/{sessions-tools,memory-tools,schemas}.test.ts`.
- [x] Agregar modo `pinnedOnly` con `scope` opcional, `maxBytes` y `cursor`. La respuesta compacta tiene `pinned`, `total` y `nextCursor`. Reusar `readPinned`. Adjuntar `PINNED_SCOPE_OVERFLOW` desde la transacción del guardado. En un reintento el aviso refleja las fijadas vigentes y el resultado durable conserva la versión original. Validar `short` después del replay para admitir peticiones históricas.
- [x] Repetir las pruebas y `bun run typecheck`. Registrar la tarea.

## 3. Referencias en el resumen y regla de protocolo

Archivos `src/infrastructure/sqlite/writes.ts`, `src/modules/sessions/rules.ts`, pruebas de resúmenes, `src/modules/memory-protocol/protocol{,.test}.ts` y documentación de arranque y MCP en `docs/es` y `docs/en`.

- [x] Probar que `Instructions` conserva el texto del autor y añade únicamente referencias de su dueño. Repetir la misma petición tras fijar otra memoria y comparar la respuesta completa. Comprobar que la regla nueva está en las dos salidas v4 y que ambas caben en sus límites.
- [x] Ver los fallos con `bun test src/interfaces/mcp/sessions-tools.test.ts src/modules/memory-protocol/protocol.test.ts`.
- [x] Adjuntar las referencias al construir el texto del resumen en la primera escritura. Guardar la huella del contenido completo para los snapshots históricos y reconstruir la huella de replay con las referencias de esa versión histórica. Verificar exportación, importación y replay en formatos 2 y 3. Actualizar el manual v4 y documentar la consulta y los avisos en ambos idiomas.
- [x] Repetir las pruebas y `bun run typecheck`. Registrar la tarea.

## Verificación conjunta

- [x] Ejecutar `FORGE614_REQUIRE_TEST_POSTGRES=1 bun run verify` con PostgreSQL disponible. Verificar los contratos MCP, la salida CLI y las versiones históricas. Revisar todo el diff y confirmar los cambios en la rama local del issue.
