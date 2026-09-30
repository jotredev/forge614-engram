# 07. Glosario

## Hogar del producto Engram

El directorio privado `~/.forge614/engram/`. Contiene configuración, base local y binario instalado de Engram. Engram nunca elimina el directorio padre compartido `~/.forge614/`.

## Identificador de proyecto (`projectId`)

UUID que identifica los recuerdos de un proyecto. No es un nombre ni una ruta. Un proyecto puede vincularse a un directorio Git canónico con `project-bind`.

## Recuerdo compartido

Recuerdo con `scope` igual a `shared` y dueño `null`. Está disponible entre proyectos; un tema activo del proyecto puede sustituir al mismo tema compartido en una búsqueda combinada.

## Ámbito (`scope`)

El "estante" donde vive un recuerdo: `project` (un repositorio), `ecosystem` (un grupo de repositorios relacionados) o `shared` (la persona, en todos sus proyectos). Con un `topicKey` repetido, la búsqueda combinada prefiere `project`, luego `ecosystem` y por último `shared`.

## Grupo y ecosistema

Un **grupo** es un conjunto con nombre de proyectos relacionados (microservicios, microfrontends, un monorepo partido, el ecosistema Forge614) que comparten el ámbito `ecosystem`. Un proyecto pertenece como máximo a un grupo. Su identidad es su `id` (UUID); el nombre (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) es para personas. Se administra con `group-create`, `group-list`, `group-bind`, `group-unbind` y `group-rename`.

## Identidad portátil del proyecto

El archivo `.forge614/project.json` en la raíz de un repositorio, versionado en Git y propiedad exclusiva de Engram: guarda el `id` y el nombre del proyecto y, si pertenece a uno, el `id` y el nombre de su grupo. Permite que mover, renombrar o clonar el repositorio conserve la memoria: la identidad viaja con el repositorio, no con la ruta.

## Clave de tema (`topicKey`)

Nombre estable de un tema, por ejemplo `architecture/database`. Actualizar un tema existente requiere su versión esperada. `MemoryStore.getByTopic(projectId, topicKey)` lo recupera de forma exacta para consumidores del SDK.

## SQLite y FTS5

SQLite es la base local durable. FTS5 es su índice léxico de texto completo. Ambos siempre permanecen locales, incluso al habilitar sincronización PostgreSQL.

## Réplica PostgreSQL

Copia sincronizada opcional del estado local de Engram, en un proyecto de PostgreSQL (por ejemplo, en Neon). Hay dos rutas independientes: los formatos 1–3, un snapshot versionado configurado con `init --json --postgres-url <URL>` y sincronizado con `sync --upgrade-format` (obsoleta desde 1.8.0, no replica `ecosystem`), y la nube de `cloud on` (desde 1.8.0), que sí replica los tres ámbitos. Ninguna reemplaza a SQLite ni a FTS5, que siguen siendo locales.

## Nube (`cloud`)

La sincronización nueva de 1.8.0 que mantiene la misma memoria en dos Mac: se activa con `cloud on`, corre sola en segundo plano dentro del servidor MCP y se apaga con `cloud off` sin borrar nada local. Sin activarla, Engram funciona exactamente igual que sin ella.

## Neon

El servicio de PostgreSQL en la nube que usa Engram para la sincronización entre Mac (`cloud on`). La dirección la crea el propietario del proyecto Neon, nunca Engram.

## Dirección de conexión

La URL completa con la que Engram se conecta a Neon (`postgresql://<usuario>:<contraseña>@<host>/<base>?sslmode=require&channel_binding=require`). Es una llave: nunca se guarda en un recuerdo ni en un archivo del repositorio, solo en `~/.forge614/engram/.env`; `cloud on` la pide en la terminal sin mostrarla.

## Id de instalación

Un UUID por Mac (`FORGE614_ENGRAM_INSTALLATION_ID`), generado la primera vez que corre `cloud on` en esa Mac. Identifica de dónde vino cada cambio subido a Neon; no cambia si repites `cloud on`.

## Cola de pendientes

La lista local (`cloud_outbox`) de cambios que todavía no se subieron a Neon. Cada guardado entra a ella en la misma transacción que el guardado en sí, así nada se pierde si se cierra la Mac antes de subir; `cloud status` muestra cuántos hay y desde cuándo espera el más viejo.

## Cambio

Una fila numerada de `forge614_sync.changes` en Neon: un alta, un cambio o un borrado de una fila de una tabla que viaja, con el id de la instalación que lo originó. Cada Mac recuerda el número más alto que ya aplicó y solo pide los posteriores.

## Primera bajada

Lo que ocurre en cada Mac la primera vez que corre `cloud on` (o cuando apunta a otra base): sube toda su memoria local que viaja y baja desde el cambio 0 lo que la otra Mac ya había subido. Si esta Mac ya tenía memoria propia, las dos terminan con la suma de ambas.

## Refuerzo

Señal local opcional de orden basada en observaciones repetidas. Puede mejorar el orden de búsqueda; no prueba que un recuerdo sea verdadero.

## Sesión

Registro de trabajo en curso por proyecto. Las sesiones permiten resúmenes estructurados, timeline y contexto después de ejecutar `sessions-enable`.

## Servidor MCP

Servidor local Model Context Protocol iniciado con `forge614-engram mcp`. Usa entrada/salida estándar y expone herramientas de memoria. El modelo puede decidir no guardar; Engram no captura transcripciones automáticamente.

## Forge614 Engines y Shell

Engines es dueño de la detección y adaptadores de IA instalada. Shell es dueño de la experiencia visual de setup y ciclo de vida. Engram no posee TUI ni configuración de clientes.

## `forge614-engram update`

Descarga el instalador oficial estable más reciente y lo ejecuta con `--force`: verifica el checksum del release y reemplaza el binario de Engram. Como en una instalación nueva, necesita Node.js 22.19+ y `tar` (si falta alguno no cambia nada y conserva el binario anterior) e instala Forge614 Shell (y Engines) si faltan. No cambia base de datos, configuración ni recuerdos.

Sin opciones, es el modo para personas y muestra el progreso del instalador. Con `--json`, es una interfaz no interactiva para herramientas: emite solo `updated`, `previousVersion` e `installedVersion` como JSON compacto, o el error seguro `UPDATE_FAILED` por stderr. Esta interfaz está disponible desde la release estable `v1.4.0`.
