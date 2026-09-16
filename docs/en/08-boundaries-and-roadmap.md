# Stage 1 Boundaries and Planned Roadmap

> **Stage:** Stage 1 — Local Memory  
> **Status:** Current & Active  
> **Sister translation:** [Versión en español](../es/08-limites-y-08-boundaries-and-roadmap.md)

This document provides a transparent overview of capabilities verified in **Stage 1**, current technical boundaries, and features planned for subsequent releases.

---

## 1. Verified and Completed Capabilities (Stage 1)

The following capabilities are fully implemented in this repository and verified by automated unit and integration tests (`bun test`):

- [x] **Local Relational Storage:** SQLite managed through `bun:sqlite` in WAL mode with foreign key enforcement and a 5,000ms busy timeout.
- [x] **Immutable Version History:** Every update to a topic retains a historical JSON snapshot in `memory_versions`.
- [x] **Optimistic Concurrency Control:** Topic updates require `--expected-version`, preventing stale overwrites across concurrent processes.
- [x] **Idempotency Safeguards:** SHA-256 payload verification via `requestKey`.
- [x] **Explainable Text Retrieval:** SQLite FTS5 with trigram tokenization and weighted columns (title: 5.0, topic: 3.0, content: 1.0).
- [x] **Mathematical Ranking:** Hybrid BM25 score combined with priority boosting (`pinned`) and recency decay ($r$).
- [x] **Literal Fallback Mode:** Seamless handling of short search terms (<3 characters) with case-insensitive Unicode folding.
- [x] **Reversible Archiving:** Archive memories to remove them from active search without erasing historical versions; restore anytime.
- [x] **Strict CLI Interface:** Complete input validation prior to opening the database; formatted JSON output for stdout and stderr.
- [x] **TypeScript SDK:** Clean `MemoryStore` programmatic API ready for internal adoption.

---

## 2. Boundaries and Out-of-Scope Items (Stage 1)

To prevent false assumptions, note the following boundaries in Stage 1:

1. **Word-Matching Search Only (No Semantic Vectors):**  
   The current search matches exact tokens and trigrams. It does not understand synonyms or paraphrasing (e.g. searching *"automobile"* will not find notes containing only *"car"*).
2. **No AI Token Budget Limiting:**  
   Search returns the complete content of matching memories without trimming or snippet summarization.
3. **No Network Server or MCP Protocol:**  
   Stage 1 contains no HTTP daemon or Model Context Protocol (MCP) server. Execution is strictly local via CLI or TypeScript imports.
4. **No Session Tracking or Handoffs:**  
   Sessions and work handoff summaries are not yet implemented.
5. **No Reinforcement Feedback or Star Ratings:**  
   Memories do not track execution success/failure or adjust salience dynamically.
6. **No Backup Export/Import Commands:**  
   Archiving only modifies database visibility flags. Exporting or importing database dumps is not yet provided.
7. **No Permanent Destructive Erasure:**  
   There is no `delete` command; obsolete memories remain archived.

---

## 3. Evolutionary Roadmap

Forge614 Engram development follows a modular roadmap:

```
┌─────────────────────────────────┐
│   Stage 1: Local Memory         │  ◄── (CURRENT STAGE COMPLETED)
│   SQLite + FTS5 + CLI + SDK     │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│   Stage 2: Sessions & Protocols │
│   MCP Server + Local HTTP       │
│   Session summaries & handoffs  │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│   Stage 3: Semantic Retrieval   │
│   Local vector embeddings       │
│   RRF fusion + MMR diversity    │
│   Strict token budget window    │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│   Stage 4: Learning Loop        │
│   Success/failure feedback      │
│   Sleep consolidation cycle     │
│   Verified backup and export    │
└─────────────────────────────────┘
```
