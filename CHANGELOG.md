# Changelog

## 1.5.3 — pendiente de revisión

- Corrección del cuelgue intermitente de la CLI en Linux: causa raíz confirmada en Bun 1.3.8 (bug del runtime, no de Engram); CI y binarios fijados a Bun 1.4.2.
- Timeout explícito por prueba en todos los e2e de CLI, por encima del timeout del lanzador.
- El SDK de MCP y `zod` ahora se cargan de forma perezosa, solo para el comando `mcp`, en vez de en cada invocación de la CLI.
- Prueba de idempotencia de `init` corregida: compara contenido lógico, no bytes.

## 1.5.2 — pendiente de revisión

- Límites de tiempo para pruebas PostgreSQL y jobs de workflow; sin cambios funcionales.

## 1.5.1 — pendiente de revisión

- `startup-context` ahora conserva el contexto `shared` y devuelve `project.status: "unbound"` para cualquier directorio existente y legible sin vínculo, incluidos el hogar, la raíz, carpetas sin Git y repositorios Git no vinculados.
- `FORGE614_HOME` permite elegir una raíz absoluta para toda la instalación de Engram; valores vacíos o relativos fallan de forma explícita con `INVALID_FORGE614_HOME` y no escriben bajo el hogar real.
