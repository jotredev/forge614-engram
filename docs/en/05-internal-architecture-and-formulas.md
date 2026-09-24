# 05 (EN). Architecture and Search

Forge614 Engram uses a feature-oriented modular monolith:

```text
src/modules/         pure domain types and rules
src/app/             use-case coordination
src/infrastructure/  SQLite, PostgreSQL, filesystem, Git, and release adapters
src/interfaces/      CLI, terminal prompts, and MCP stdio server
src/shared/          errors and shared utilities
```

Dependency rules are enforced by architecture tests. Interfaces call application public entries; they do not open SQLite or import infrastructure directly. Sibling products use Engram's public SDK or CLI, never private source folders.

SQLite is the durable source of truth. FTS5 performs literal lexical full-text search. Reinforcement changes result ordering using repeated observations and recency; it does not use embeddings and does not assert factual truth.

From schema 11 (memory intelligence, 1.7.0) a second FTS5 index over whole words (`unicode61`, accent-insensitive) sits next to the trigram index, together with side tables for memory metadata (short version, review date, replacement, affected projects), session activity and each group's source project. Those tables stay outside the memory version, so replication formats 1–3 do not change. Level 11 is enabled only explicitly with `intelligence-enable`, with a backup and verification; the MCP server never migrates the database.

The schema-11 hybrid search builds the query by dropping filler words (Spanish and English), folding accents and case, and joining the remaining terms with OR (16 at most); when every word is filler, all of them are used. In the word index, terms of 4 or more letters match by prefix; in the trigram index, terms of 3 or more letters match anywhere, both as written and with accents folded. Each index contributes up to 50 candidates; they are fused by reciprocal rank fusion (`1/(60+rank)` in each list where a result appears) and the result is multiplied by the same reinforcement multiplier `fts5` already uses (pinned, recency, stability): `orderScore = -(rrf × multiplier)`, lower is better. A result is dropped unless it contains at least 2 of the query terms (all of them when there are fewer than 2), matched by substring for terms of 3 or more letters and as a whole word otherwise; a query with no words at all (only punctuation) returns nothing. Saving a new memory without a topic also computes Jaccard similarity over distinct words (filler and accents removed) against the other active memories of the same scope and owner; a score of 0.25 or higher is reported as a look-alike (up to 3; see chapter 4).

PostgreSQL synchronization transfers a versioned snapshot of local state. It is optional, explicit, and cannot replace the local SQLite/FTS5 read/write path. Format promotion requires `sync --upgrade-format` after every participating device is compatible. `ecosystem` memories are not replicated yet: until format 4 (its own plan, 1.8.0), `sync` stops with `SYNC_ECOSYSTEM_UNSUPPORTED` if they exist.

The product currently ships verified macOS and Linux standalone binaries. There is no Windows native addon, installer, or release artifact in the current product.
