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

Desde el esquema 11 (memoria inteligente, 1.7.0) hay un segundo índice FTS5 por palabras completas (`unicode61`, sin distinguir acentos) junto al índice por trigramas, y tablas aparte para metadatos del recuerdo (versión corta, vigencia, reemplazo, proyectos afectados), actividad de sesión y proyecto fuente de cada grupo. Esas tablas quedan fuera de la versión del recuerdo, así que los formatos de réplica 1–3 no cambian. El nivel 11 se activa solo de forma explícita con `intelligence-enable`, con respaldo y verificación; el servidor MCP nunca migra la base.

La búsqueda híbrida del esquema 11 arma la consulta quitando palabras vacías (español e inglés), pliega acentos y mayúsculas y une los términos restantes con OR (máximo 16); si todas las palabras son vacías se usan todas. En el índice de palabras los términos de 4 o más letras buscan por prefijo; en el de trigramas los de 3 o más letras buscan en cualquier posición, tanto con acento como sin él. Cada índice aporta hasta 50 candidatos; se combinan por rango recíproco (RRF: `1/(60+rango)` en cada lista donde aparece) y el resultado se multiplica por el mismo multiplicador de refuerzo que usa `fts5` (fijado, recencia, estabilidad): `orderScore = -(rrf × multiplicador)`, menor es mejor. Un resultado se descarta si no contiene al menos 2 de los términos de la consulta (todos si hay menos de 2), por subcadena si el término tiene 3 letras o más y como palabra completa si es más corto; una consulta sin ninguna palabra (solo signos) no devuelve nada. Al guardar un recuerdo nuevo sin tema se calcula además similitud de Jaccard sobre las palabras distintas (sin vacías ni acentos) contra los demás recuerdos activos del mismo ámbito y dueño; a partir de 0,25 se reporta como parecido (hasta 3, consulta el capítulo 4).

La sincronización PostgreSQL transfiere un snapshot versionado del estado local. Es opcional, explícita y no reemplaza la ruta local SQLite/FTS5. Promover formato requiere `sync --upgrade-format` cuando todos los equipos sean compatibles. Las memorias de ámbito `ecosystem` no se replican todavía: hasta el formato 4 (plan propio, 1.8.0), `sync` se detiene con `SYNC_ECOSYSTEM_UNSUPPORTED` si existen.

El producto publica actualmente binarios autónomos verificados para macOS y Linux. No hay addon nativo, instalador ni artefacto de release para Windows en el producto actual.
