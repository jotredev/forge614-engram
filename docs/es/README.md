# Forge614 Engram — Documentación Oficial (Español)

> **Etapa:** Centro de Control TUI, FTS5 Reforzado ([sin embeddings](conceptos/que-son-los-embeddings.md)), Monolito Modular por Funcionalidad, Sesiones de Memoria Progresiva, Contexto Clasificado, 10 Herramientas MCP, Memoria Local y Sincronización PostgreSQL Opcional
> **Esquemas:** SQLite Esquemas 3 (local) / 4 (sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas) / 7 (confirmaciones inmutables y orden reforzado) | Réplica PostgreSQL Formatos 1, 2 y 3 (promoción explícita con `sync --upgrade-format`; tabla física remota `state.format = 1`)
> **Habilitaciones:** Explícitas y aditivas (`integration-enable` para Esquema 5; `sessions-enable` para Esquema 6; `reinforcement-enable` para Esquema 7; `sync --upgrade-format` para réplica Formato 2 o Formato 3). Nunca automáticas en lecturas ordinarias, apertura de base ni arranque del centro de control TUI.
> **Estado:** Vigente y Verificado (536 superadas, 13 omitidas de plataforma/PG local, 0 fallos, 2606 aserciones en 88 archivos en macOS ARM64 con Bun 1.3.8; validación nativa en CI en Ubuntu, macOS y Windows x64 Verify Run ID 35427426902 y Release Run ID 35427429725)
> **Traducción hermana:** [Official English Documentation](../en/README.md)
> **Entorno de compilación:** Bun >= 1.3.8 | TypeScript 5.9 estricto | Git (obligatorio para resolución de proyectos)
> **Ejecutable autónomo:** `forge614-engram` en `$HOME/.local/bin/` o `%LOCALAPPDATA%\Forge614\bin\` (funciona de forma autónoma sin Bun ni Node en ejecución habitual)
> **Espacio central de usuario:** `~/.forge614/` (`.env` de configuración única y `engram.db` de base única)

> [!TIP]
> **¿No te queda claro qué significa "sin embeddings" o qué es un embedding?**
> Lee nuestra explicación ilustrada en lenguaje cotidiano (sin tecnicismos o con aclaración entre paréntesis): **[¿Qué son los Embeddings y por qué Forge614 Engram funciona SIN ellos?](conceptos/que-son-los-embeddings.md)**.

---

## 1. Resumen Ejecutivo (¿Qué es en una sola frase?)

**Forge614 Engram** es un sistema de memoria personal y local que reside en la carpeta de tu usuario (`~/.forge614/`), estructurado internamente como un **monolito modular organizado por funcionalidad** (separando reglas puras de dominio, coordinación de aplicación, adaptadores de infraestructura e interfaces), diseñado para que tus asistentes de desarrollo (Claude Code, Codex, Cursor, OpenCode y Antigravity) y aplicaciones recuerden decisiones técnicas duraderas y preferencias compartidas a través de un servidor MCP nativo por stdio con 10 herramientas especializadas, asociaciones de proyecto basadas en Git, un **Centro de Control interactivo en terminal (TUI)** con lectura segura por defecto y confirmación estricta de dos pasos (`confirm` + Enter), sesiones de memoria progresiva con líneas temporales (`timeline`), contexto ensamblado clasificado (`context`), control inmutable de versiones, búsqueda local explicable reforzada por repeticiones [sin embeddings](conceptos/que-son-los-embeddings.md) (SQLite FTS5 trigram con ponderación por estabilidad y actualidad), y una réplica opcional directa con PostgreSQL con promoción segura a Formato 3.

---

## 2. El Problema del Mundo Real que Resuelve

Cuando desarrollas software con asistentes de inteligencia artificial en tu entorno de trabajo, surgen problemas críticos de continuidad y gestión:

1. **Amnesia al reiniciar la conversación (*Context Window Reset*):** Cada nueva sesión o compactación de contexto olvida qué dependencias elegiste, qué estilo de código acordaron o qué errores ya investigaron y resolvieron.
2. **Saturación ciega de la ventana de contexto (*Context Bloat*):** Cargar recuerdos completos sin podar consume la memoria del modelo y degrada su atención. Engram introduce búsquedas con vista previa acotada en caracteres Unicode, lecturas bajo demanda y ensamblaje de contexto con presupuesto estricto de bytes serializados.
3. **Pérdida de la narrativa de trabajo (*Session Narrative Loss*):** Sin sesiones progresivas, el modelo no distingue qué recuerdos se grabaron durante una tarea específica ni en qué orden temporal relativo se sucedieron los hallazgos.
4. **Ediciones destructivas y duplicados engañosos (*Destructive Overwrites & Redundant Versions*):** Si modificas una decisión, los sistemas tradicionales sobrescriben la nota. Si vuelves a guardar el mismo dato idéntico, otros motores crean versiones 2, 3 y 4 vacías que saturan el historial. Engram registra **confirmaciones inmutables** que reafirman la estabilidad sin inventar versiones redundantes.
5. **Gestión a ciegas sin panel de supervisión (*Dashboard Blindness*):** Saber qué proyectos están registrados, qué rutas están asociadas, qué capacidades están activas o cuántos recuerdos existen obligaba a consultar manualmente la base de datos o memorizar comandos. Engram incorpora un **Centro de Control TUI** que presenta toda la información de proyectos, memoria compartida y almacenamiento de forma segura e interactiva sin alterar datos ni exponer secretos.
6. **Buscadores de "caja negra" (*Opaque Scoring*):** La mayoría de motores devuelven notas sin explicar qué palabras exactas coincidieron ni qué fórmula matemática justificó el orden de entrega.
7. **Fragmentación de configuración de asistentes (*Configuration Drift*):** Configurar servidores MCP y ganchos de contexto (*hooks*) a mano en cinco editores distintos genera discrepancias, archivos corruptos y conflictos de plugins.
8. **Ambigüedad de proyectos y ramas (*Worktree/Subdirectory Confusion*):** Si trabajas en una subcarpeta o en un entorno de trabajo derivado de Git (*linked worktree*), los asistentes suelen considerarlo un proyecto nuevo huérfano, dispersando la memoria.
9. **Aislamiento entre múltiples computadoras (*Device Siloing*):** Al alternar entre laptop y computadora de escritorio, las notas quedan atrapadas en un solo disco sin una réplica privada que las sincronice.

Forge614 Engram resuelve esto con **una única base SQLite central local**, un servidor MCP nativo estándar con 10 herramientas, sesiones progresivas, un Centro de Control TUI interactivo, resolución canónica de proyectos por Git, búsqueda local FTS5 reforzada sin embeddings y sincronización opcional con PostgreSQL.

---

## 3. La Analogía Maestra: El Archivero Metódico, el Panel de Mandos TUI y el Sello de Repetición

Imagina que contratas a un archivero muy ordenado para custodiar la memoria de todos tus proyectos de software:

- **El Gabinete Central (`~/.forge614/engram.db`):** El archivero guarda todos los papeles en un único mueble seguro en tu oficina local con permisos estrictos (`0600`). Las búsquedas y lecturas siempre se realizan en este mueble local, sin importar si hay conexión a internet.
- **El Panel de Mandos de la Terminal (Centro de Control TUI / `forge614-engram tui`):** En la entrada de su oficina, el archivero monta una pantalla interactiva de supervisión (`Resumen | Proyectos | Shared | Almacenamiento | Acciones | Asistentes | Salir`).
  - *Lectura por defecto:* Al abrir el panel o navegar con las flechas, el archivero solo lee y muestra estadísticas agregadas. Jamás crea archivos, bases de datos ni proyectos por el mero hecho de abrir o recorrer la pantalla.
  - *Información visible y protegida:* Muestra nombres de proyectos, identificadores UUID abreviados o completos en el detalle, rutas SQLite, esquemas 3–7 y si PostgreSQL está configurado. Oculta de forma absoluta contraseñas, URLs de PostgreSQL, contenidos de `.env` y el texto de los recuerdos.
  - *Confirmación de dos pasos:* Si solicitas crear un proyecto, renombrarlo, asociar una carpeta, habilitar un esquema o sincronizar, el archivero exige una vista previa, que escribas exactamente `confirm` (en cualquier combinación de mayúsculas/minúsculas) y presiones Enter. Presionar Enter solo jamás autoriza escrituras.
  - *Subflujo de Asistentes:* Si eliges "Asistentes", el archivero apaga temporalmente el panel, abre el configurador existente con vista previa y autoprueba, y al terminar recarga un resumen fresco sin anidar sesiones en crudo de terminal.
- **La Ventanilla Estandarizada MCP (`mcp` por stdio):** En la pared de su oficina, el archivero atiende a través de una ventanilla de comunicación directa (*Model Context Protocol* por entrada y salida estándar / *stdio*). Los asistentes de desarrollo disponen de **diez herramientas oficiales** (`memory_context`, `memory_current_project`, `memory_get`, `memory_history`, `memory_save`, `memory_search`, `memory_session_end`, `memory_session_start`, `memory_session_summary`, `memory_timeline`).
- **El Diario de Sesión Progresiva (`sessions` y `timeline`):** Cuando un asistente inicia una jornada de trabajo, abre un diario con un identificador de sesión (`sessionId`). Cada recuerdo que anota durante esa tarea queda registrado en una tira cronológica inmutable (`session_entries`). Si el asistente necesita revisar qué descubrió justo antes o después de una decisión, le pide al archivero desplegar la **línea temporal (*timeline*)**.
- **El Sello de Repetición Inmutable (Esquema 7 y `reinforcement-enable`):** Si el asistente vuelve a observar y guardar exactamente la misma nota activa (mismo título, contenido, tipo, tema y fijado), el archivero no imprime una versión 2 innecesaria. En su lugar, estampa un **sello de confirmación inmutable** con un identificador único (`confirmationId`), la hora exacta y la sesión actual. Esa confirmación incrementa ligeramente la estabilidad en búsquedas, pero **el archivero jamás afirma que la nota sea verdadera ni que un humano la haya verificado**.
- **La Ventana de Observación de 15 Minutos (Deduplicación sin Tema):** Para notas generales sin tema clave (`topicKey: null`), el archivero solo considera idéntica una nota observada en los últimos 15 minutos (900,000 ms). Si pasa más tiempo, asume que es una nota nueva independiente para evitar agrupar observaciones separadas en el tiempo.
- **La Ficha de Contexto Ensamblado (`context`):** Al comenzar una interacción o tras compactar la memoria del modelo, el asistente no pide toda la base de datos de golpe; le pide al archivero una ficha ejecutiva que reúne hasta 20 notas fijadas prioritarias, hasta 20 recuerdos recientes y hasta 5 resúmenes de sesiones anteriores, todo podado limpiamente para encajar dentro de un límite estricto de bytes serializados en JSON (`maxBytes`).
- **El Resumen Estructurado de Cierre (`session-summary`):** Al concluir una sesión, el asistente entrega una bitácora final con seis apartados rigurosos (*goal*, *instructions*, *discoveries*, *accomplishments*, *nextSteps*, *files*), archivada como procedimiento bajo el tema reservado `session/<sessionId>/summary`.
- **El Mostrador Compartido Universal (`scope: "shared"`):** Las notas generales (por ejemplo: *"Escribir código con tipado estricto"*) se guardan una sola vez sin dueño de proyecto (`projectId: null`). Si se asocian a una sesión mediante `sessionProjectId`, el archivero registra la entrada pero jamás revela metadatos de origen privado en las respuestas de notas compartidas.
- **La Valija Segura de Sincronización (PostgreSQL Formato 3):** Al sincronizar réplicas entre computadoras, el archivero empaqueta instantáneas completas de proyectos, recuerdos, sesiones y confirmaciones. La réplica remota se promueve a Formato 3 conscientemente con `sync --upgrade-format` mediante validación optimista CAS sobre `forge614_sync.state`.

---

## 4. Principios Fundamentales del Sistema

- **SQLite y FTS5 Siempre Locales:** PostgreSQL no sustituye a SQLite ni a su motor de búsqueda de texto completo. Todas las operaciones se ejecutan local y síncronamente en `engram.db`.
- **Centro de Control TUI Seguro y de Solo Lectura por Defecto:**
  - El comando `forge614-engram tui` requiere una terminal interactiva (TTY); en entornos sin TTY falla limpiamente con `INTERACTIVE_REQUIRED`.
  - Navegar, redimensionar la ventana o ingresar datos erróneos no crea archivos de configuración ni bases de datos. Si el sistema no está inicializado, informa que se use `setup` o `init`.
  - Las acciones mutativas exigen escribir la palabra `confirm` y pulsar Enter. Pulsar solo Enter o cancelar con Escape o Ctrl+C restaura la terminal sin modificar un solo byte.
  - Si una acción ya confirmada está en curso, se ignoran pulsaciones repetidas y la terminal se restaura con seguridad al salir, aunque la acción iniciada no se promete revertir.
  - La TUI delega en los métodos existentes de la capa de aplicación (`MemoryWorkspace`, `MemoryStore`, `syncWorkspace`), cerrando recursos con bloques `finally`; nunca ejecuta SQL ni modifica el sistema de archivos de forma directa.
- **Habilitaciones Explícitas y Aditivas:**
  - Esquema 5 (asistentes y carpetas locales): se activa exclusivamente con `integration-enable` o mediante el Centro de Control TUI.
  - Esquema 6 (sesiones progresivas y líneas temporales): se activa con `sessions-enable` o en la TUI.
  - Esquema 7 (confirmaciones inmutables y orden reforzado): se activa con `reinforcement-enable`, en la TUI o en `setup`.
  - Las migraciones son estrictamente aditivas e irreversibles (sin marcha atrás / *no downgrade*). Ningún comando ordinario auto-migra la base.
- **[Sin Embeddings](conceptos/que-son-los-embeddings.md) ni Modelos Evaluadores de Verdad:** La búsqueda es 100% textual y matemática sobre SQLite FTS5 trigram. No hay embeddings vectoriales, re-entrenamiento ni un modelo secundario juzgando contradicciones. Una confirmación refleja únicamente que el asistente volvió a registrar la nota; no representa verificación humana de verdad.
- **Claves de Petición Idempotentes (`requestKey`):** El asistente debe usar la misma `requestKey` para reintentar una operación fallida (devolviendo el resultado anterior sin sumar confirmaciones) y una clave nueva para observaciones independientes. Si se reutiliza una clave con contenido distinto, el sistema aborta de inmediato con `REQUEST_CONFLICT`.
- **Límites Transparentes: Caracteres Unicode vs Bytes JSON vs Tokens:**
  - Las vistas previas acotan texto a **300 caracteres Unicode** (500 para foco y 150 para vecinos en `timeline`).
  - El parámetro `maxBytes` acota el tamaño de **bytes del JSON serializado** (1024 a 65536, por defecto 16384).
  - **Ninguno de estos límites representa un presupuesto de tokens de LLM.** Los asistentes deben administrar su ventana de contexto considerando esta distinción.
- **Fórmula Matemática de Ranking Reforzado (Esquema 7):** Ponderación BM25 combinada con recencia, estabilidad y fijado:
  $$\text{multiplier} = 1 + 0.10 \times \text{pinned} + \frac{0.06}{1 + \text{ageDays}/30} + 0.04 \times \frac{n}{n + 4}$$
  donde $n = \text{revisionCount} + \text{duplicateCount}$ y $\text{ageDays} = \max(0, (\text{now} - \text{lastSeenAt}) / 86400000)$. El ordenamiento final se realiza en orden ascendente por `bm25 * multiplier` (donde BM25 de SQLite es negativo y menor valor indica mayor relevancia) y desempate por `id ASC`.
- **Saneamiento Exhaustivo en Terminal:** Todos los textos externos presentados en la TUI pasan por filtros que reemplazan códigos de escape ANSI, caracteres de control, secuencias bidireccionales (bidi), caracteres de ancho cero y URLs no deseadas, impidiendo ataques de inyección visual en la terminal.
- **Resolución Canónica Git Obligatoria:** Git es obligatorio (`git rev-parse --path-format=absolute --git-common-dir`) para unificar *worktrees* y subcarpetas bajo el mismo `projectId`.

---

## 5. Índice Secuencial de Documentación en Español

1. [**01. Instalación, Configuración y Primeros Pasos (`01-instalacion-y-primeros-pasos.md`)**](01-instalacion-y-primeros-pasos.md): Comandos oficiales de instalación (`curl`/`irm`), verificación contra `SHA256SUMS`, publicación automática e idempotente de PATH (Unix y Windows), cero herramientas de desarrollo para el usuario final, asistente interactivo `setup` con traspaso automático al selector de asistentes (onboarding), semántica de cancelación, Centro de Control TUI (`forge614-engram tui`), detección de los 5 asistentes compatibles, y habilitación de Esquemas 5, 6 y 7.
2. [**02. Recorrido Guiado del Sistema (`02-recorrido-guiado.md`)**](02-recorrido-guiado.md): Tutorial completo del ciclo de vida: uso del Centro de Control TUI interactivo, ciclo de sesiones (`session-start`, `session-end`, `session-summary`), inferencia automática de sesiones, notas asociadas, confirmaciones sin versiones redundantes, ventana móvil de 15 minutos, búsquedas reforzadas con vista previa (`--preview`), lecturas versionadas (`get --version`), línea temporal (`timeline`), contexto ensamblado (`context`), actualización de plugins de OpenCode y réplica PostgreSQL con `--upgrade-format` a Formato 3.
3. [**03. Manual Exhaustivo de Terminal (`03-referencia-cli.md`)**](03-referencia-cli.md): Catálogo exhaustivo comando por comando (`tui`, `reinforcement-enable`, `sessions-enable`, `session-start`, `session-end`, `session-summary`, `timeline`, `context`, `search [--preview]`, `get [--version]`, `save [--request-key, --session-id, --session-project-id]`, `sync [--upgrade-format]`, `mcp`, etc.) con parámetros, pantallas TUI, códigos de salida y formatos JSON.
4. [**04. Guía del SDK de TypeScript (`04-sdk-typescript.md`)**](04-sdk-typescript.md): Guía del SDK TypeScript: exportaciones públicas estables desde `src/index.ts`, fachada compatible `MemoryStore` en `app/` (`controlCenter()`, `enableSearchReinforcement()`, `reinforcementEnabled()`), función de aplicación `readControlCenter()`, tipos de resumen y arquitectura síncrona local.
5. [**05. Arquitectura Interna, Monolito Modular y Fórmulas (`05-arquitectura-interna-y-formulas.md`)**](05-arquitectura-interna-y-formulas.md): Monolito modular por funcionalidad (`modules/control-center`, `infrastructure/sqlite/control-center`, `app/control-center`, `interfaces/tui/control-center-*`), máquina de estados pura, renderizado acotado y saneado, pruebas colocadas (504 tests en 82 archivos), DDL Esquema 7, fórmulas matemáticas de ranking FTS5 reforzado sin embeddings, payload Formato 3 y atribución a Gentleman.
6. [**06. Resolución de Problemas y Catálogo de Errores (`06-resolucion-de-errores.md`)**](06-resolucion-de-errores.md): Catálogo completo de códigos de error (`INTERACTIVE_REQUIRED`, `REINFORCEMENT_REQUIRED`, `SYNC_UPGRADE_REQUIRED`, `CLOCK_SKEW`, `REQUEST_CONFLICT`, `MIGRATION_REQUIRED`, `AMBIGUOUS_SESSION`, `NO_SESSION_CONTEXT`, `SESSION_CONFLICT`, `SESSION_NOT_FOUND`, `SESSION_CLOSED`, `SUMMARY_TOPIC_RESERVED`, `SYNC_TOO_LARGE`, `CONFLICT`, etc.) con causas raíz y pasos de recuperación.
7. [**07. Glosario de Conceptos en Lenguaje Cotidiano (`07-glosario.md`)**](07-glosario.md): Definiciones claras con analogías cotidianas y términos técnicos formales entre paréntesis: Centro de Control TUI, lectura por defecto, confirmación de dos pasos, saneamiento de salida en terminal, subflujo secuencial, confirmación inmutable, refuerzo FTS5 sin embeddings, ventana móvil de deduplicación, etc.
8. [**08. Límites de la Etapa y Hoja de Ruta Futura (`08-limites-y-roadmap.md`)**](08-limites-y-roadmap.md): Capacidades completadas (Fases 1 a 4.3), límites operativos (TUI sin GUI ni daemon ni monitor remoto de salud, búsqueda puramente textual sin embeddings, confirmación no es verdad) y roadmap oficial con las fases pendientes.

---

## 💡 Conceptos Fundamentales Explicados para Todo Público
- 📘 [**¿Qué son los Embeddings y por qué Forge614 Engram funciona SIN ellos? (`conceptos/que-son-los-embeddings.md`)**](conceptos/que-son-los-embeddings.md): Guía ilustrada con la analogía de la biblioteca, comparativa directa de por qué la memoria local sin embeddings es gratuita ($0), instantánea (<2ms), privada (100% offline) y quirúrgicamente exacta para código.
