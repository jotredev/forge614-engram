# Plain-Language Glossary

> **Stage:** Stage 1 — Local Memory  
> **Status:** Current & Active  
> **Sister translation:** [Versión en español](../es/07-glosario.md)

This glossary explains every concept using everyday analogies, followed by the formal English technical term in parentheses.

---

### Organized storage file (Database)
A structured file on your storage drive designed to store, organize, and retrieve notes rapidly without mixing information between projects.

### Text instruction window (Terminal / CLI / Command Line Interface)
A window where you type direct text commands to control software without visual buttons or mouse clicks.

### Structured data format (JSON / JavaScript Object Notation)
A clean and universal text format using key-value labels that both humans and computers can easily read.

### Workspace drawer (Project scope)
A required label that groups memories belonging to a single project or application, preventing records from bleeding into other workspaces.

### Historical snapshot (Version / Revision snapshot)
An immutable digital photocopy of a memory's text exactly as it existed at the moment it was stored.

### Quick lookup index (Full-text inverted index)
An internal catalog created by the database listing every word across your notes, enabling sub-millisecond retrieval just like the index at the back of a textbook.

### Three-letter fragment search (Trigram tokenization)
A text processing technique that divides words into overlapping 3-character slices (e.g. `sqlite` becomes `sql`, `qli`, `lit`, `ite`), allowing partial word and substring matching.

### Text match scoring algorithm (BM25)
A classic information retrieval formula that evaluates how closely a memory matches search terms. In SQLite, it produces negative numbers where more negative values indicate stronger relevance.

### Highlighted or prioritized note (Pinned memory)
A flag (`pinned = true`) signaling that a memory is critically important, giving it a score multiplier boost to surface at the top of search rankings.

### Freshness multiplier (Recency decay)
A mathematical curve that awards higher priority to recently modified notes and gradually lowers the ranking of neglected records.

### Duplicate submission prevention (Idempotency / Request key)
A safeguard ensuring that repeating the exact same command (e.g. after a network interruption) returns the existing record without creating duplicate entries.

### All-or-nothing operation (Database transaction / Atomic rollback)
A safety boundary grouping multiple updates together. If any step fails midway, all changes are reverted to the original state, preventing corrupted or half-written records.

### Write-Ahead Logging (WAL mode)
A high-throughput SQLite storage method where changes are recorded first in a fast append-only log (`.sqlite-wal`), allowing readers to access the database without waiting for disk writes to finish.

### Topic categorization key (Topic key)
A label (e.g. `architecture/database`) that links related revisions of a single concept over time, ensuring a project maintains exactly one active version for that topic.

### Set-aside note (Archived state)
A state that hides a note from active daily searches while preserving its complete history for audit or future reactivation.

### Software Development Kit (SDK)
A collection of code functions and TypeScript classes allowing programmers to integrate the memory system directly into custom software applications.
