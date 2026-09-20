# 02 (EN). Guided Walkthrough

1. Install Engram and open a new terminal.
2. Run `forge614-engram init` for guided local memory initialization, or `init --json` for automation.
3. Create a project with `project-create --name <name>` and retain its returned `projectId`.
4. Save durable knowledge with `save --project-id <UUID> --title <title> --content <text>`. Add `--topic <key>` for one replaceable topic.
5. Search project plus shared knowledge with `search --project-id <UUID> --query <words>`. Use `--scope shared` for shared-only results.
6. Use `get`, `history`, `archive`, `restore`, and `context` to retrieve and manage knowledge safely.
7. Enable sessions explicitly with `sessions-enable`, then use `session-start`, `session-summary`, and `session-end` for resumable work.
8. Enable repeated-memory ordering only when wanted with `reinforcement-enable`.
9. Configure PostgreSQL only when a synchronized replica is needed; local SQLite/FTS5 remains the first read/write path.
10. Start `forge614-engram mcp` when an already configured AI client needs memory tools. Engram does not select or configure that client.
11. Run `forge614-engram update` to install the latest stable binary without changing memories.

All projects share one SQLite database, but memory ownership is always determined by `projectId` or explicit shared scope.
