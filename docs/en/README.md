# Forge614 Engram — Official Documentation (English)

> **Stage:** Stage 1 — Local Memory  
> **Status:** Current & Active  
> **Sister translation:** [Versión en español](../es/README.md)  
> **Runtime environment:** Bun >= 1.3.8 | SQLite (FTS5 with trigram tokenizer) | Strict TypeScript 5.9

---

## 1. Executive Summary (What is it in a single sentence?)

**Forge614 Engram** is a personal memory notepad that lives inside your own computer (locally), built so that your artificial intelligence assistants and applications can retain important facts, decisions, and procedures over time without losing past revisions, instantly retrieving notes through an explainable built-in search engine.

---

## 2. The Real-World Problem It Solves

When working with artificial intelligence assistants or everyday software, three persistent challenges arise:

1. **Amnesia when closing a conversation:** Every time you open a new chat session, the assistant completely forgets past agreements, what database you chose, or what rules you established.
2. **Destructive edits (overwrite without a trace):** If you revise an important decision, traditional note systems overwrite the previous entry, erasing the historical record of why your approach changed.
3. **Black-box search engines:** Many retrieval systems return notes without explaining why they selected that information or which words matched.

Forge614 Engram solves this by storing every memory inside a single file on your hard drive, maintaining an immutable tree of historical versions, and exposing the exact mathematical formula that determines relevance when searching.

---

## 3. The Master Analogy: The Archival Clerk with an Audit Ledger

Imagine hiring a meticulous clerk in your office:

- **The Project Drawer:** The clerk maintains separate folders for each project (`--project`). Documents from one project are never mixed with another.
- **The Memory Cards:** Each card contains a clear note: what happened, what category it belongs to (a verified fact, a design decision, a procedure, a warning, or a preference), and the exact timestamp.
- **The Version Archive:** If you update instructions regarding your project's database (`--topic architecture/database`), the clerk does not shred the old card; they make a dated photocopy, file it into the historical version archive, and place the new card in front with the next version number.
- **The Duplicate Prevention Stamp (Idempotency):** If a script attempts to deliver the exact same note twice using the same dispatch order (`--request-key`), the clerk checks the ledger, recognizes the stamp, and returns the original card without writing duplicates into the drawer.
- **The Quick Index:** When you search for a word, the clerk consults an alphabetical index split into three-letter fragments (trigram index) and delivers cards containing all your words, explaining the exact calculation of recency and priority used to rank them.

---

## 4. Fundamental Design Principles

- **100% Local and Private:** Requires no cloud API keys, sends zero data to external services, and makes no remote AI model calls. Contains no telemetry or tracking.
- **Zero External Runtime Dependencies:** All storage runs on SQLite via the engine built directly into Bun (`bun:sqlite`).
- **Strict Project Scoping:** Every operation requires specifying its target project (`--project`). If the project name does not match, access is denied. (Note: this provides internal data separation, not user password authentication).
- **No Destructive Erasure in this Stage:** Archiving a memory (`archive`) merely hides it from active searches. The note and all its versions remain intact for historical audit or restoration (`restore`).

---

## 5. Sequential Documentation Table of Contents

Explore the documentation following the chronological study path:

1. [**01. Getting Started (`01-installation-and-getting-started.md`)**](01-installation-and-getting-started.md): Bun prerequisites, project setup, and saving your first memory in under two minutes.
2. [**02. System Walkthrough Guide (`02-guided-walkthrough.md`)**](02-guided-walkthrough.md): Step-by-step tutorial covering the complete memory lifecycle (save, revise, search, archive, and audit).
3. [**03. Terminal CLI Reference (`03-cli-reference.md`)**](03-cli-reference.md): Every command documented individually with options, real examples, and JSON response formats.
4. [**04. TypeScript SDK Guide (`04-typescript-sdk.md`)**](04-typescript-sdk.md): How to import the `MemoryStore` class into your source code and manage memories programmatically.
5. [**05. Internal Architecture and Formulas (`05-internal-architecture-and-formulas.md`)**](05-internal-architecture-and-formulas.md): SQLite table schemas, automated triggers, FTS5 trigram tokenization, and mathematical ranking formulas.
6. [**06. Troubleshooting and Errors (`06-troubleshooting.md`)**](06-troubleshooting.md): Comprehensive catalog of error codes (`INVALID_INPUT`, `VERSION_CONFLICT`, etc.), explained causes, and recommended solutions.
7. [**07. Plain-Language Glossary (`07-glossary.md`)**](07-glossary.md): Everyday explanations for every technical term used in the project.
8. [**08. Boundaries and Roadmap (`08-boundaries-and-roadmap.md`)**](08-boundaries-and-roadmap.md): Features completed in Stage 1 and planned capabilities (MCP protocol, sessions, vector embeddings) for future stages.
