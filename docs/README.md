# Forge614 Engram — Documentación / Documentation

> **Etapa / Stage:** Memoria Local y Sincronización PostgreSQL Opcional / Local Memory & Optional PostgreSQL Sync
> **Versiones / Versions:** Programa / Program 0.4.0 | Formato / Config Format 2 (local) / 3 (sync) | Esquema / SQLite Schema 3 (local) / 4 (sync)
> **Estado / Status:** Vigente y Verificado / Current & Verified (90 pruebas totales / 90 total tests: 86 superadas y 4 omitidas sin binarios PG; 90 superadas, 0 fallos, 645 aserciones con PostgreSQL 17.6 aislado en macOS con Bun 1.3.8)
> **Entorno / Runtime:** Bun >= 1.3.8 | SQLite (FTS5 trigram local) | PostgreSQL >= 14 (réplica de sincronización opcional) | TypeScript 5.9

Bienvenido a la documentación oficial de **Forge614 Engram**, un sistema de memoria personal y local para modelos de inteligencia artificial y aplicaciones, diseñado para recordar decisiones de proyectos y preferencias generales compartidas en tu propia computadora, con control de revisiones, búsqueda explicable y sincronización opcional directa con PostgreSQL.

Welcome to the official documentation for **Forge614 Engram**, a personal local memory system for artificial intelligence models and applications, designed to retain project decisions and shared universal preferences on your own computer with revision tracking, explainable search, and optional direct synchronization with PostgreSQL.

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
| **00** | [README.md](es/README.md) | [README.md](en/README.md) | Resumen ejecutivo, analogía y principios / Executive summary, analogy, and principles |
| **01** | [01-instalacion-y-primeros-pasos.md](es/01-instalacion-y-primeros-pasos.md) | [01-installation-and-getting-started.md](en/01-installation-and-getting-started.md) | Asistente `setup`, sincronización PostgreSQL, comandos `init`, proyectos y primer recuerdo / `setup` wizard, PostgreSQL sync, `init`, projects, and first memory |
| **02** | [02-recorrido-guiado.md](es/02-recorrido-guiado.md) | [02-guided-walkthrough.md](en/02-guided-walkthrough.md) | Recorrido interactivo, ciclo de vida, recuerdos compartidos y sincronización (`sync`, `sync-watch`) / Interactive setup, lifecycle, shared memory, and synchronization walkthrough |
| **03** | [03-referencia-cli.md](es/03-referencia-cli.md) | [03-cli-reference.md](en/03-cli-reference.md) | Manual detallado comando por comando (`setup`, `init`, `sync`, `sync-watch`, etc.) / Exhaustive terminal command reference (`setup`, `init`, `sync`, `sync-watch`, etc.) |
| **04** | [04-sdk-typescript.md](es/04-sdk-typescript.md) | [04-typescript-sdk.md](en/04-typescript-sdk.md) | Guía del SDK TypeScript (`MemoryWorkspace`, `runSetup`, `MemoryStore`) / TypeScript SDK guide |
| **05** | [05-arquitectura-interna-y-formulas.md](es/05-arquitectura-interna-y-formulas.md) | [05-internal-architecture-and-formulas.md](en/05-internal-architecture-and-formulas.md) | Esquemas SQLite v3/v4 y PostgreSQL `forge614_sync`, fusión 3-way, WAL y BM25 / SQLite schemas v3/v4 & PostgreSQL `forge614_sync`, 3-way merge, WAL & BM25 |
| **06** | [06-resolucion-de-errores.md](es/06-resolucion-de-errores.md) | [06-troubleshooting.md](en/06-troubleshooting.md) | Catálogo de errores locales y de sincronización (`SYNC_CONFLICT`, `POSTGRES_URL`, etc.) / Troubleshooting and error catalog |
| **07** | [07-glosario.md](es/07-glosario.md) | [07-glossary.md](en/07-glossary.md) | Glosario en lenguaje común / Plain-language glossary |
| **08** | [08-limites-y-roadmap.md](es/08-limites-y-roadmap.md) | [08-boundaries-and-roadmap.md](en/08-boundaries-and-roadmap.md) | Límites vigentes (8 MiB, sin resolución automática), política futura y 3 fases pendientes / Active boundaries, future policy, and 3 pending phases |

---

## 🏛️ Publicación en Notion / Notion Hub

Este contenido se encuentra publicado y sincronizado bajo el archivo central de estudios **AI Engineer** en Notion:
- **Espacio:** AI Engineer > Librerías > `Forge614 Engram — Memoria Personal Local`
- **Subpáginas Indexadas:** Totalmente desglosadas por temas y numeradas cronológicamente para lectura guiada en español e inglés.
