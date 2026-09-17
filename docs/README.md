# Forge614 Engram — Documentación / Documentation

> **Etapa / Stage:** MCP Local, Menú TUI de Asistentes, Memoria Local y Sincronización PostgreSQL Opcional / Local MCP, Assistant TUI Menu, Local Memory & Optional PostgreSQL Sync
> **Versiones / Versions:** Programa / Program 0.5.0 | Formato / Config Format 2 (local) / 3 (sync) | Esquema / SQLite Schema 3 (local) / 4 (sync) / 5 (asistentes y asociaciones locales / assistant integration)
> **Estado / Status:** Vigente y Verificado / Current & Verified (191 pruebas totales en 16 archivos / 191 total tests across 16 files: 187 superadas y 4 omitidas sin binarios aislados PG; 191 superadas, 0 fallos, 1133 aserciones con `FORGE614_TEST_POSTGRES_BIN` configurado)
> **Entorno / Runtime:** Bun >= 1.3.8 (para compilar / to build) | Ejecutable compilado autónomo (sin Bun ni Node en ejecución / standalone executable without Bun or Node at runtime) | Git disponible (obligatorio para resolución de proyectos / mandatory for project identity) | macOS / Linux (Bash) | SQLite (FTS5 trigram local) | PostgreSQL >= 14 (réplica de sincronización opcional / optional sync replica) | TypeScript 5.9 | MCP SDK 1.30.0

Bienvenido a la documentación oficial de **Forge614 Engram**, un sistema de memoria personal y local para modelos de inteligencia artificial y aplicaciones, diseñado para recordar decisiones de proyectos y preferencias generales compartidas en tu propia computadora, con control de revisiones, búsqueda explicable, servidor MCP nativo por stdio, menú interactivo de asistentes en terminal (TUI) y sincronización opcional directa con PostgreSQL.

Welcome to the official documentation for **Forge614 Engram**, a personal local memory system for artificial intelligence models and applications, designed to retain project decisions and shared universal preferences on your own computer with revision tracking, explainable search, a native stdio MCP server, an interactive terminal assistant menu (TUI), and optional direct synchronization with PostgreSQL.

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
| **00** | [README.md](es/README.md) | [README.md](en/README.md) | Resumen ejecutivo, analogía del archivero con mostrador MCP y principios / Executive summary, archivist analogy with MCP counter, and principles |
| **01** | [01-instalacion-y-primeros-pasos.md](es/01-instalacion-y-primeros-pasos.md) | [01-installation-and-getting-started.md](en/01-installation-and-getting-started.md) | Prerrequisitos (Bun, Git obligatorio), instalación de binario autónomo, `setup`, detección de asistentes y `integration-enable` / Prerequisites (Bun, mandatory Git), standalone binary install, `setup`, assistant detection, and `integration-enable` |
| **02** | [02-recorrido-guiado.md](es/02-recorrido-guiado.md) | [02-guided-walkthrough.md](en/02-guided-walkthrough.md) | Recorrido interactivo: menú `tui`, autoprueba MCP de 5s, previsualización, confirmación, uso con asistentes, ganchos nativos y réplica PostgreSQL / Interactive walkthrough: `tui` menu, 5s MCP self-test, preview, confirmation, assistant usage, native hooks, and PostgreSQL replica |
| **03** | [03-referencia-cli.md](es/03-referencia-cli.md) | [03-cli-reference.md](en/03-cli-reference.md) | Manual detallado de comandos (`setup`, `tui`, `mcp`, `assistant-list`, `integration-enable`, `project-bind`, `memory-hook`, `sync`, etc.) / Exhaustive terminal command reference |
| **04** | [04-sdk-typescript.md](es/04-sdk-typescript.md) | [04-typescript-sdk.md](en/04-typescript-sdk.md) | Guía del SDK TypeScript (`MemoryWorkspace`, `MemoryStore` con Esquema 5) y delimitación de módulos internos / TypeScript SDK guide with Schema 5 and internal modules |
| **05** | [05-arquitectura-interna-y-formulas.md](es/05-arquitectura-interna-y-formulas.md) | [05-internal-architecture-and-formulas.md](en/05-internal-architecture-and-formulas.md) | Esquema 5 (`project_bindings`), resolución Git y worktrees, protocolo MCP (5 herramientas), adaptadores seguros (`0600`/UUID) y fusión 3-way / Schema 5, Git resolution & worktrees, MCP protocol (5 tools), secure adapters (`0600`/UUID), and 3-way merge |
| **06** | [06-resolucion-de-errores.md](es/06-resolucion-de-errores.md) | [06-troubleshooting.md](en/06-troubleshooting.md) | Catálogo completo de errores (`INTERACTIVE_REQUIRED`, `PROJECT_IDENTITY_UNAVAILABLE`, `PUBLISHED_UNVERIFIED`, etc.) y recuperación / Comprehensive error catalog and troubleshooting |
| **07** | [07-glosario.md](es/07-glosario.md) | [07-glossary.md](en/07-glossary.md) | Glosario en lenguaje cotidiano con términos técnicos entre paréntesis / Plain-language glossary with technical terms in parentheses |
| **08** | [08-limites-y-roadmap.md](es/08-limites-y-roadmap.md) | [08-boundaries-and-roadmap.md](en/08-boundaries-and-roadmap.md) | Límites vigentes (modelos voluntarios, fixtures vs sesiones reales, 8 MiB) y roadmap de 2 fases pendientes / Active limits and roadmap with 2 remaining phases |

---

## 🏛️ Publicación en Notion / Notion Hub

Este contenido se encuentra publicado y sincronizado bajo el archivo central de estudios **AI Engineer** en Notion:
- **Espacio:** AI Engineer > Librerías > `Forge614 Engram — Memoria Personal Local`
- **Subpáginas Indexadas:** Totalmente desglosadas por temas y numeradas cronológicamente para lectura guiada en español e inglés.
