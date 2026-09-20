# 07. Glosario

## Hogar del producto Engram

El directorio privado `~/.forge614/engram/`. Contiene configuración, base local y binario instalado de Engram. Engram nunca elimina el directorio padre compartido `~/.forge614/`.

## Identificador de proyecto (`projectId`)

UUID que identifica los recuerdos de un proyecto. No es un nombre ni una ruta. Un proyecto puede vincularse a un directorio Git canónico con `project-bind`.

## Recuerdo compartido

Recuerdo con `scope` igual a `shared` y dueño `null`. Está disponible entre proyectos; un tema activo del proyecto puede sustituir al mismo tema compartido en una búsqueda combinada.

## Clave de tema (`topicKey`)

Nombre estable de un tema, por ejemplo `architecture/database`. Actualizar un tema existente requiere su versión esperada. `MemoryStore.getByTopic(projectId, topicKey)` lo recupera de forma exacta para consumidores del SDK.

## SQLite y FTS5

SQLite es la base local durable. FTS5 es su índice léxico de texto completo. Ambos siempre permanecen locales, incluso al habilitar sincronización PostgreSQL.

## Réplica PostgreSQL

Copia sincronizada opcional del estado local de Engram. No reemplaza SQLite ni FTS5. Se configura con `init --json --postgres-url <URL>` y se sincroniza explícitamente.

## Refuerzo

Señal local opcional de orden basada en observaciones repetidas. Puede mejorar el orden de búsqueda; no prueba que un recuerdo sea verdadero.

## Sesión

Registro de trabajo en curso por proyecto. Las sesiones permiten resúmenes estructurados, timeline y contexto después de ejecutar `sessions-enable`.

## Servidor MCP

Servidor local Model Context Protocol iniciado con `forge614-engram mcp`. Usa entrada/salida estándar y expone herramientas de memoria. El modelo puede decidir no guardar; Engram no captura transcripciones automáticamente.

## Forge614 Engines y Shell

Engines es dueño de la detección y adaptadores de IA instalada. Shell es dueño de la experiencia visual de setup y ciclo de vida. Engram no posee TUI ni configuración de clientes.

## `forge614-engram update`

Descarga el instalador oficial estable más reciente, verifica el checksum del release y reemplaza solo el binario instalado de Engram. No cambia base de datos, configuración ni recuerdos.
