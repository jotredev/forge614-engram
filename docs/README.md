# Forge614 Engram — Documentación / Documentation

> **Etapa / Stage:** Monolito Modular por Funcionalidad, Sesiones de Memoria Progresiva, Contexto Clasificado, 10 Herramientas MCP, Memoria Local y Sincronización PostgreSQL / Feature-Oriented Modular Monolith, Progressive Memory Sessions, Ranked Context, 10 MCP Tools, Local Memory & PostgreSQL Sync
> **Esquemas / Schemas:** SQLite Esquemas 3 (local) / 4 (sync) / 5 (asistentes y asociaciones locales) / 6 (sesiones progresivas y resúmenes estructurados) | Réplica PostgreSQL Formato 1 / Formato 2 (promoción explícita con `sync --upgrade-format`)
> **Habilitaciones / Enrollments:** Explícitas y aditivas (`integration-enable` para Esquema 5; `sessions-enable` para Esquema 6; `sync --upgrade-format` para réplica Formato 2). Nunca automáticas en lecturas ordinarias ni apertura de base.
> **Estado / Status:** Vigente y Verificado / Current & Verified (369 pruebas totales en 69 archivos / 369 total tests across 69 files: 361 superadas y 8 omitidas sin binarios aislados PG; 369 superadas, 0 fallos, 1891 aserciones con `FORGE614_TEST_POSTGRES_BIN` configurado)
> **Entorno / Runtime:** Bun >= 1.3.8 (para compilar / to build) | Ejecutable compilado autónomo (sin Bun ni Node en ejecución habitual / standalone executable without Bun or Node at runtime) | Git disponible (obligatorio para resolución de proyectos / mandatory for project identity) | macOS / Linux (Bash) | SQLite (FTS5 trigram local) | PostgreSQL >= 14 (réplica de sincronización opcional / optional sync replica) | TypeScript 5.9 | MCP SDK 1.30.0

Bienvenido a la documentación oficial de **Forge614 Engram**, un sistema de memoria personal y local para modelos de inteligencia artificial y aplicaciones de software estructurado internamente como un **monolito modular organizado por funcionalidad** (separando reglas de negocio, coordinación de aplicación, adaptadores de infraestructura e interfaces de usuario/asistente), diseñado para retener decisiones técnicas de proyectos y preferencias universales compartidas en tu propia computadora, con control de revisiones, búsqueda explicable, servidor MCP nativo por stdio con 10 herramientas de memoria, menú interactivo de asistentes en terminal (TUI), sesiones de memoria progresiva con líneas temporales (`timeline`), contexto ensamblado clasificado (`context`), y sincronización opcional directa con PostgreSQL con promoción segura de formato.

Welcome to the official documentation for **Forge614 Engram**, a personal local memory system for artificial intelligence models and software applications structured internally as a **feature-oriented modular monolith** (separating business rules, application coordination, infrastructure adapters, and user/assistant interfaces), designed to retain project decisions and shared universal preferences on your own computer with revision tracking, explainable search, a native stdio MCP server featuring 10 memory tools, an interactive terminal assistant menu (TUI), progressive memory sessions with session timelines (`timeline`), ranked assembled prompt context (`context`), and optional direct synchronization with PostgreSQL with safe format promotion.

---

## 🌐 Selecciona tu idioma / Select your language

| Idioma / Language | Descripción / Description | Enlace al Índice / Index Link |
| :--- | :--- | :--- |
| 🇪🇸 **Español** | Documentación completa en español indexada secuencialmente (01, 02, 03...). | [Ir a docs/es/](es/README.md) |
| 🇬🇧 **English** | Complete English documentation sequentially indexed (01, 02, 03...). | [Go to docs/en/](en/README.md) |

---

## 📑 Índice Secuencial Maestro / Sequential Master Index

Para facilitar el estudio y la lectura ordenada, el contenido se encuentra estrictamente indexado con numeración secuencial de dos dígitos (`01`, `02`, `03`...):

| Paso / Step | 🇪🇸 Archivo en Español | 🇬🇧 English File | Contenido / Content |
| :--- | :--- | :--- | :--- |
| **00** | [README.md](es/README.md) | [README.md](en/README.md) | Resumen ejecutivo, analogía del archivero con mostrador MCP, ciclo de sesiones progresivas y principios / Executive summary, archivist analogy with MCP counter, progressive session lifecycle, and principles |
| **01** | [01-instalacion-y-primeros-pasos.md](es/01-instalacion-y-primeros-pasos.md) | [01-installation-and-getting-started.md](en/01-installation-and-getting-started.md) | Prerrequisitos (Bun, Git obligatorio), instalación de binario autónomo, `setup`, detección de asistentes, habilitación de Esquema 5 (`integration-enable`) y Esquema 6 (`sessions-enable`), y sincronización entre equipos / Prerequisites (Bun, mandatory Git), standalone binary install, `setup`, assistant detection, Schema 5 (`integration-enable`) and Schema 6 (`sessions-enable`) enrollments, and peer-device sync |
| **02** | [02-recorrido-guiado.md](es/02-recorrido-guiado.md) | [02-guided-walkthrough.md](en/02-guided-walkthrough.md) | Recorrido guiado: ciclo de sesiones (`session-start`, `session-end`, `session-summary`), inferencia de sesiones (0, 1 o varias), búsquedas con vista previa (`--preview`), lecturas versionadas, línea temporal (`timeline`), contexto clasificado (`context`), actualización segura de plugins OpenCode y réplica PostgreSQL con `--upgrade-format` / Guided walkthrough: session lifecycle, session inference (0, 1, or multiple), preview search, versioned get, timeline, ranked context, safe OpenCode plugin update, and PostgreSQL replica with `--upgrade-format` |
| **03** | [03-referencia-cli.md](es/03-referencia-cli.md) | [03-cli-reference.md](en/03-cli-reference.md) | Manual exhaustivo de comandos CLI: `sessions-enable`, `session-start`, `session-end`, `session-summary`, `timeline`, `context`, `search [--preview]`, `get [--version]`, `save [--session-id, --session-project-id]`, `sync [--upgrade-format]`, etc. / Exhaustive CLI command reference |
| **04** | [04-sdk-typescript.md](es/04-sdk-typescript.md) | [04-typescript-sdk.md](en/04-typescript-sdk.md) | Guía del SDK TypeScript: exportaciones públicas desde `src/index.ts`, fachada compatible `MemoryStore`, eliminación de rutas internas previas y sincronía de base / TypeScript SDK guide: public exports from `src/index.ts`, `MemoryStore` facade, removal of deep internal imports, and synchronous engine |
| **05** | [05-arquitectura-interna-y-formulas.md](es/05-arquitectura-interna-y-formulas.md) | [05-internal-architecture-and-formulas.md](en/05-internal-architecture-and-formulas.md) | Monolito modular por funcionalidad (`app`, `modules`, `infrastructure`, `interfaces`, `shared`), reglas de imports y auditoría AST, mapa antes/después, transacciones compuestas, guía de cambios, pruebas colocadas (369 tests en 69 archivos) y fórmulas de ranking / Feature-oriented modular monolith, import rules and AST auditor, before/after mapping, composite transactions, change placement guide, colocated tests (369 tests in 69 files), and ranking formulas |
| **06** | [06-resolucion-de-errores.md](es/06-resolucion-de-errores.md) | [06-troubleshooting.md](en/06-troubleshooting.md) | Catálogo completo de errores (`MIGRATION_REQUIRED`, `AMBIGUOUS_SESSION`, `NO_SESSION_CONTEXT`, `SESSION_CONFLICT`, `SESSION_NOT_FOUND`, `SUMMARY_TOPIC_RESERVED`, `SYNC_TOO_LARGE`, `CONFLICT`) y procedimientos de recuperación / Error catalog and troubleshooting |
| **07** | [07-glosario.md](es/07-glosario.md) | [07-glossary.md](en/07-glossary.md) | Glosario en lenguaje cotidiano con términos técnicos en paréntesis: sesión progresiva, línea temporal, resumen estructurado, contexto ensamblado, promoción de formato, etc. / Plain-language glossary with technical terms in parentheses |
| **08** | [08-limites-y-roadmap.md](es/08-limites-y-roadmap.md) | [08-boundaries-and-roadmap.md](en/08-boundaries-and-roadmap.md) | Límites activos (modelos probabilísticos, ausencia de ID nativo en MCP stdio, orden temporal de registro, límites de 8 MiB) y roadmap oficial con las 2 fases pendientes / Active limits and official roadmap with 2 remaining phases |

---

## 🏛️ Publicación en Notion / Notion Hub

Este contenido se encuentra publicado y sincronizado bajo el archivo central de estudios **AI Engineer** en Notion:
- **Espacio:** AI Engineer > Librerías > `Forge614 Engram — Memoria Personal Local`
- **Subpáginas Indexadas:** Totalmente desglosadas por temas y numeradas cronológicamente para lectura guiada en español e inglés.
