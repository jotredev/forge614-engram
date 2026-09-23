# 05. Arquitectura Interna y Búsqueda

Forge614 Engram usa un monolito modular por funcionalidad:

```text
src/modules/         tipos y reglas puras del dominio
src/app/             coordinación de casos de uso
src/infrastructure/  adaptadores SQLite, PostgreSQL, filesystem, Git y releases
src/interfaces/      CLI, preguntas de terminal y servidor MCP por stdio
src/shared/          errores y utilidades compartidas
```

Pruebas de arquitectura imponen las dependencias. Las interfaces llaman entradas públicas de aplicación; no abren SQLite ni importan infraestructura directamente. Los productos hermanos usan SDK o CLI públicos de Engram, nunca carpetas fuente privadas.

SQLite es la fuente durable de verdad. FTS5 hace búsqueda léxica literal. El refuerzo cambia el orden mediante observaciones repetidas y recencia; no usa embeddings ni afirma verdad factual.

La sincronización PostgreSQL transfiere un snapshot versionado del estado local. Es opcional, explícita y no reemplaza la ruta local SQLite/FTS5. Promover formato requiere `sync --upgrade-format` cuando todos los equipos sean compatibles. Las memorias de ámbito `ecosystem` no se replican todavía: hasta el formato 4 (plan propio, 1.7.0), `sync` se detiene con `SYNC_ECOSYSTEM_UNSUPPORTED` si existen.

El producto publica actualmente binarios autónomos verificados para macOS y Linux. No hay addon nativo, instalador ni artefacto de release para Windows en el producto actual.
