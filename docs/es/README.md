# Forge614 Engram — Documentación Oficial (Español)

> **Etapa:** Monolito Modular por Funcionalidad, Sesiones de Memoria Progresiva, Contexto Clasificado, 10 Herramientas MCP, Memoria Local y Sincronización PostgreSQL Opcional
> **Esquemas:** SQLite Esquemas 3 (local) / 4 (sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas y resúmenes estructurados) | Réplica PostgreSQL Formato 1 / Formato 2 (promoción explícita con `sync --upgrade-format`)
> **Habilitaciones:** Explícitas y aditivas (`integration-enable` para Esquema 5; `sessions-enable` para Esquema 6; `sync --upgrade-format` para réplica Formato 2). Nunca automáticas en lecturas ordinarias ni al abrir la base.
> **Estado:** Vigente y Verificado (369 pruebas totales en 69 archivos: 361 superadas y 8 omitidas sin binarios aislados PG; 369 superadas, 0 fallos, 1891 aserciones con `FORGE614_TEST_POSTGRES_BIN` configurado)
> **Traducción hermana:** [Official English Documentation](../en/README.md)
> **Entorno de compilación:** Bun >= 1.3.8 | TypeScript 5.9 estricto | Git (obligatorio para resolución de proyectos)
> **Ejecutable autónomo:** `forge614-engram` en `$HOME/.local/bin/` (funciona de forma autónoma sin Bun ni Node en ejecución habitual)
> **Espacio central de usuario:** `~/.forge614/` (`.env` de configuración única y `engram.db` de base única)

---

## 1. Resumen Ejecutivo (¿Qué es en una sola frase?)

**Forge614 Engram** es un sistema de memoria personal y local que reside en la carpeta de tu usuario (`~/.forge614/`), estructurado internamente como un **monolito modular organizado por funcionalidad** (separando reglas puras de dominio, coordinación de aplicación, adaptadores de infraestructura e interfaces), diseñado para que tus asistentes de desarrollo (Claude Code, Codex, Cursor, OpenCode y Gemini CLI) y aplicaciones recuerden decisiones técnicas duraderas y preferencias compartidas a través de un servidor MCP nativo por stdio con 10 herramientas especializadas, asociaciones de proyecto basadas en Git, menú interactivo en terminal (TUI), sesiones de memoria progresiva con líneas temporales (`timeline`), contexto ensamblado clasificado (`context`), control inmutable de versiones y una réplica opcional directa con PostgreSQL con promoción segura de formato.

---

## 2. El Problema del Mundo Real que Resuelve

Cuando desarrollas software con asistentes de inteligencia artificial en tu entorno de trabajo, surgen problemas críticos de continuidad:

1. **Amnesia al reiniciar la conversación (*Context Window Reset*):** Cada nueva sesión o compactación de contexto olvida qué dependencias elegiste, qué estilo de código acordaron o qué errores ya investigaron y resolvieron.
2. **Saturación ciega de la ventana de contexto (*Context Bloat*):** Cargar recuerdos completos sin podar consume la memoria del modelo y degrada su atención. Engram introduce búsquedas con vista previa acotada en caracteres Unicode, lecturas bajo demanda y ensamblaje de contexto con presupuesto estricto de bytes serializados.
3. **Pérdida de la narrativa de trabajo (*Session Narrative Loss*):** Sin sesiones progresivas, el modelo no distingue qué recuerdos se grabaron durante una tarea específica ni en qué orden temporal relativo se sucedieron los hallazgos.
4. **Ediciones destructivas sin rastro (*Destructive Overwrites*):** Si modificas una decisión previa, los sistemas habituales sobreescriben la nota, destruyendo el historial y la justificación técnica de por qué se cambió de criterio.
5. **Buscadores de "caja negra" (*Opaque Scoring*):** La mayoría de motores devuelven notas sin explicar qué palabras exactas coincidieron ni qué fórmula matemática justificó el orden de entrega.
6. **Fragmentación de configuración de asistentes (*Configuration Drift*):** Configurar servidores MCP y ganchos de contexto (*hooks*) a mano en cinco editores distintos genera discrepancias, archivos corruptos y conflictos de plugins.
7. **Ambigüedad de proyectos y ramas (*Worktree/Subdirectory Confusion*):** Si trabajas en una subcarpeta o en un entorno de trabajo derivado de Git (*linked worktree*), los asistentes suelen considerarlo un proyecto nuevo huérfano, dispersando la memoria.
8. **Aislamiento entre múltiples computadoras (*Device Siloing*):** Al alternar entre laptop y computadora de escritorio, las notas quedan atrapadas en un solo disco sin una réplica privada que las sincronice.

Forge614 Engram resuelve esto con **una única base SQLite central local**, un servidor MCP nativo estándar con 10 herramientas, sesiones progresivas inspiradas en el protocolo Gentleman con adaptaciones de Forge614, menús TUI interactivos, resolución canónica de proyectos por Git y sincronización opcional con PostgreSQL.

---

## 3. La Analogía Maestra: El Archivero Metódico, la Ventanilla MCP y el Diario de Sesión

Imagina que contratas a un archivero muy ordenado para custodiar la memoria de todos tus proyectos de software:

- **El Gabinete Central (`~/.forge614/engram.db`):** El archivero guarda todos los papeles en un único mueble seguro en tu oficina local con permisos estrictos (`0600`). Las búsquedas y lecturas siempre se realizan en este mueble local, sin importar si hay conexión a internet.
- **La Ventanilla Estandarizada MCP (`mcp` por stdio):** En la pared de su oficina, el archivero atiende a través de una ventanilla de comunicación directa (*Model Context Protocol* por entrada y salida estándar / *stdio*). Los asistentes de desarrollo disponen de **diez herramientas oficiales** (`memory_context`, `memory_current_project`, `memory_get`, `memory_history`, `memory_save`, `memory_search`, `memory_session_end`, `memory_session_start`, `memory_session_summary`, `memory_timeline`).
- **El Diario de Sesión Progresiva (`sessions` y `timeline`):** Cuando un asistente inicia una jornada de trabajo, abre un diario con un identificador de sesión (`sessionId`). Cada recuerdo que anota durante esa tarea queda registrado en una tira cronológica inmutable (`session_entries`). Si el asistente necesita revisar qué descubrió justo antes o después de una decisión, le pide al archivero desplegar la **línea temporal (*timeline*)**.
- **La Ficha de Contexto Ensamblado (`context`):** Al comenzar una interacción o tras compactar la memoria del modelo, el asistente no pide toda la base de datos de golpe; le pide al archivero una ficha ejecutiva que reúne hasta 20 notas fijadas prioritarias, hasta 20 recuerdos recientes y hasta 5 resúmenes de sesiones anteriores, todo podado limpiamente para encajar dentro de un límite estricto de bytes serializados en JSON (`maxBytes`).
- **El Resumen Estructurado de Cierre (`session-summary`):** Al concluir una sesión, el asistente entrega una bitácora final con seis apartados rigurosos (*goal*, *instructions*, *discoveries*, *accomplishments*, *nextSteps*, *files*), archivada como procedimiento bajo el tema reservado `session/<sessionId>/summary`.
- **La Inferencia Inteligente de Sesiones:** Si el asistente guarda una nota de proyecto sin especificar el `sessionId`, el archivero busca si existe una única sesión de ejecución abierta en esa carpeta dentro de los últimos 7 días. Si hay exactamente una, la asocia automáticamente (`inferred`); si hay varias abiertas, se detiene y exige aclaración (`AMBIGUOUS_SESSION`); y si no hay ninguna, la asocia al cuaderno manual local del proyecto (`manual`).
- **El Mostrador Compartido Universal (`scope: "shared"`):** Las notas generales (por ejemplo: *"Escribir código con tipado estricto"*) se guardan una sola vez sin dueño de proyecto (`projectId: null`). Si se asocian a una sesión mediante `sessionProjectId`, el archivero registra la entrada pero jamás revela metadatos de origen privado en las respuestas de notas compartidas.
- **La Valija Segura de Sincronización (PostgreSQL con Formato 2):** Al sincronizar réplicas entre computadoras, el archivero empaqueta instantáneas completas de proyectos, recuerdos y sesiones. Las réplicas remotas en formato antiguo se promueven exclusivamente de forma consciente con `sync --upgrade-format` mediante validación optimista CAS.

---

## 4. Principios Fundamentales del Sistema

- **SQLite y FTS5 Siempre Locales:** PostgreSQL no sustituye a SQLite ni a su motor de búsqueda de texto completo. Todas las operaciones se ejecutan local y síncronamente en `engram.db`.
- **Habilitaciones Explícitas y Aditivas:**
  - Esquema 5 (asistentes y carpetas locales): se activa exclusivamente con `integration-enable` o mediante `tui`.
  - Esquema 6 (sesiones progresivas y líneas temporales): se activa exclusivamente con `sessions-enable`.
  - Las lecturas, búsquedas, herramientas MCP y comandos ordinarios **nunca auto-migran la base de datos local**. Los equipos pares deben instalar la versión compatible, ejecutar `sessions-enable` y luego sincronizar.
- **Diez Herramientas MCP Nativas por stdio:** `stdout` está reservado 100% para JSON-RPC. Los asistentes deben consultar `memory_current_project` y `memory_context` o `memory_search` antes de repetir investigación.
- **Límites Transparentes: Caracteres Unicode vs Bytes JSON vs Tokens:**
  - Las vistas previas acotan texto a **300 caracteres Unicode** (500 para foco y 150 para vecinos en `timeline`).
  - El parámetro `maxBytes` acota el tamaño de **bytes del JSON serializado** (1024 a 65536, por defecto 16384).
  - **Ninguno de estos límites representa un presupuesto de tokens de LLM.** Los asistentes deben administrar su ventana de contexto considerando esta distinción.
- **Fórmula de Relevancia Corregida:** Ponderación BM25 combinada con recencia y fijación:
  $$\text{multiplier} = 1 + 0.10 \times \text{pinned} + \frac{0.06}{1 + \text{ageDays}/30}$$
  con $\text{ageDays} \ge 0$. El ordenamiento final se realiza en orden ascendente por `bm25 * multiplier` y desempate por `id ASC`. Las búsquedas literales de términos cortos (<3 caracteres) utilizan su propio orden por fijación, fecha y ID sin BM25.
- **Atribución Arquitectónica:** El comportamiento de búsqueda progresiva por vista previa, líneas temporales y lectura de versiones está inspirado en **Gentleman**, mientras que la identidad por UUID, las sesiones por equipo, las vinculaciones de ruta local (`project_bindings`), la inferencia de sesiones y la promoción de réplicas son adaptaciones y diseños propios de **Forge614**.
- **Seguridad en Plugins de OpenCode:** Si existe un plugin generado en una carpeta activa de OpenCode con contenido distinto, Engram lo detecta como conflicto de configuración (`CONFLICT`) y **nunca lo sobrescribe automáticamente**. El usuario debe revisar la vista previa, respaldar el archivo existente, reconciliarlo y volver a aplicar.
- **Modelos Probabilísticos y Salvaguardas:** Los modelos de IA pueden omitir voluntariamente el guardado de notas o resúmenes. Los ganchos nativos (*hooks*) orientan al modelo pero no pueden garantizar guardados ni cierres limpios ante cancelaciones abruptas.
- **Resolución Canónica Git Obligatoria:** Git es obligatorio (`git rev-parse --path-format=absolute --git-common-dir`) para unificar *worktrees* y subcarpetas bajo el mismo `projectId`.

---

## 5. Índice Secuencial de Documentación en Español

1. [**01. Instalación, Configuración y Primeros Pasos (`01-instalacion-y-primeros-pasos.md`)**](01-instalacion-y-primeros-pasos.md): Prerrequisitos (Bun >=1.3.8, Git obligatorio), instalación de dependencias, script `install.sh`, binario autónomo, asistente interactivo `setup`, detección de asistentes, habilitación de Esquema 5 (`integration-enable`), Esquema 6 (`sessions-enable`) y coordinación entre equipos pares.
2. [**02. Recorrido Guiado del Sistema (`02-recorrido-guiado.md`)**](02-recorrido-guiado.md): Tutorial completo del ciclo de sesiones: inicio de sesión (`session-start`), inferencia automática de sesiones (casos 0, 1 y múltiples candidatos), notas asociadas, búsquedas con vista previa (`--preview`), lecturas versionadas (`get --version`), línea temporal (`timeline`), contexto ensamblado (`context`), resumen final (`session-summary`), cierre (`session-end`), actualización segura de plugins de OpenCode y réplica PostgreSQL con `--upgrade-format`.
3. [**03. Manual Exhaustivo de Terminal (`03-referencia-cli.md`)**](03-referencia-cli.md): Catálogo exhaustivo comando por comando (`sessions-enable`, `session-start`, `session-end`, `session-summary`, `timeline`, `context`, `search [--preview]`, `get [--version]`, `save [--session-id, --session-project-id]`, `sync [--upgrade-format]`, `mcp`, `tui`, etc.) con parámetros, códigos de salida y formatos JSON.
4. [**04. Guía del SDK de TypeScript (`04-sdk-typescript.md`)**](04-sdk-typescript.md): Guía del SDK TypeScript: exportaciones públicas estables desde `src/index.ts`, fachada compatible `MemoryStore` en `app/`, eliminación de rutas internas obsoletas y arquitectura síncrona local.
5. [**05. Arquitectura Interna, Monolito Modular y Fórmulas (`05-arquitectura-interna-y-formulas.md`)**](05-arquitectura-interna-y-formulas.md): Monolito modular por funcionalidad (`app`, `modules`, `infrastructure`, `interfaces`, `shared`), reglas de imports y auditoría AST, mapa antes/después, transacciones compuestas en `writes.ts`, guía de colocación de cambios, pruebas colocadas (369 tests en 69 archivos) y fórmulas BM25 con recencia.
6. [**06. Resolución de Problemas y Catálogo de Errores (`06-resolucion-de-errores.md`)**](06-resolucion-de-errores.md): Catálogo completo de códigos de error (`MIGRATION_REQUIRED`, `AMBIGUOUS_SESSION`, `NO_SESSION_CONTEXT`, `SESSION_CONFLICT`, `SESSION_NOT_FOUND`, `SESSION_CLOSED`, `SESSION_KIND`, `SUMMARY_TOPIC_RESERVED`, `SYNC_TOO_LARGE`, `CONFLICT`, etc.) con causas raíz y pasos de recuperación.
7. [**07. Glosario de Conceptos en Lenguaje Cotidiano (`07-glosario.md`)**](07-glosario.md): Definiciones claras con analogías cotidianas y términos técnicos formales entre paréntesis.
8. [**08. Límites de la Etapa y Hoja de Ruta Futura (`08-limites-y-roadmap.md`)**](08-limites-y-roadmap.md): Capacidades completadas de sesiones progresivas, límites operativos y roadmap con las 2 fases pendientes.
