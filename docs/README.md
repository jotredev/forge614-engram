# Forge614 Engram — Documentación / Documentation

> **Etapa 1: Memoria Local (Configuración Interactiva y Base Única) / Stage 1: Local Memory (Interactive Setup & Single DB)**
> **Versiones / Versions:** Programa / Program 0.3.0 | Formato / Config Format 2 | Esquema / SQLite Schema 3
> **Estado / Status:** Vigente y Verificado / Current & Verified (75 pruebas superadas / 75 tests passed on macOS with Bun 1.3.8)
> **Entorno / Runtime:** Bun >= 1.3.8 | SQLite (FTS5 trigram) | TypeScript 5.9

Bienvenido a la documentación oficial de **Forge614 Engram**, un sistema de memoria personal y local para modelos de inteligencia artificial y aplicaciones, diseñado para recordar decisiones de proyectos y preferencias generales compartidas en tu propia computadora, con control de revisiones y búsqueda explicable.

Welcome to the official documentation for **Forge614 Engram**, a personal local memory system for artificial intelligence models and applications, designed to retain project decisions and shared universal preferences on your own computer with revision tracking and explainable search.

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
| **01** | [01-instalacion-y-primeros-pasos.md](es/01-instalacion-y-primeros-pasos.md) | [01-installation-and-getting-started.md](en/01-installation-and-getting-started.md) | Asistente `setup`, comandos `init`, proyectos y primer recuerdo / `setup` wizard, `init`, projects, and first memory |
| **02** | [02-recorrido-guiado.md](es/02-recorrido-guiado.md) | [02-guided-walkthrough.md](en/02-guided-walkthrough.md) | Recorrido interactivo, ciclo de vida y recuerdos compartidos / Interactive setup, lifecycle, and shared memory walkthrough |
| **03** | [03-referencia-cli.md](es/03-referencia-cli.md) | [03-cli-reference.md](en/03-cli-reference.md) | Manual detallado comando por comando (`setup`, `init`, etc.) / Exhaustive terminal command reference (`setup`, `init`, etc.) |
| **04** | [04-sdk-typescript.md](es/04-sdk-typescript.md) | [04-typescript-sdk.md](en/04-typescript-sdk.md) | Guía del SDK TypeScript (`MemoryWorkspace`, `runSetup`, `MemoryStore`) / TypeScript SDK guide |
| **05** | [05-arquitectura-interna-y-formulas.md](es/05-arquitectura-interna-y-formulas.md) | [05-internal-architecture-and-formulas.md](en/05-internal-architecture-and-formulas.md) | Esquema SQLite v3, inicialización WAL, triggers y BM25 / SQLite schema v3, WAL initialization, triggers & BM25 |
| **06** | [06-resolucion-de-errores.md](es/06-resolucion-de-errores.md) | [06-troubleshooting.md](en/06-troubleshooting.md) | Catálogo de errores (`INTERACTIVE_REQUIRED`, etc.) / Troubleshooting and error catalog |
| **07** | [07-glosario.md](es/07-glosario.md) | [07-glossary.md](en/07-glossary.md) | Glosario en lenguaje común / Plain-language glossary |
| **08** | [08-limites-y-roadmap.md](es/08-limites-y-roadmap.md) | [08-boundaries-and-roadmap.md](en/08-boundaries-and-roadmap.md) | Límites vigentes, política futura y hoja de ruta de 4 fases / Active boundaries, future policy, and 4-phase roadmap |

---

## 🏛️ Publicación en Notion / Notion Hub

Este contenido se encuentra publicado y sincronizado bajo el archivo central de estudios **AI Engineer** en Notion:
- **Espacio:** AI Engineer > Librerías > `Forge614 Engram — Memoria Personal Local`
- **Subpáginas Indexadas:** Totalmente desglosadas por temas y numeradas cronológicamente para lectura guiada.
