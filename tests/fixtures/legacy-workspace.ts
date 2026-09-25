import { MemoryStore } from "../../src/app/memory-store";
import type { WorkspaceConfig } from "../../src/infrastructure/filesystem/workspace-config";

/**
 * Builds a configured (.env present) workspace database at the oldest supported schema level
 * (3: no project bindings, sessions, reinforcement, ecosystem or intelligence structure yet) --
 * exactly what a real installation predating memory intelligence looks like on disk.
 *
 * Since MemoryWorkspace.init() now births every brand-new database directly at schema 11
 * (memory intelligence, which already includes sessions and reinforcement), tests of behavior
 * that only makes sense for an older, still-configured base -- an existing database is never
 * migrated by init; reinforcement/intelligence enrollment explicitly migrating an older base;
 * setup asking whether to enable reinforcement -- must start from a database built with this
 * helper instead of a fresh MemoryWorkspace.init().
 *
 * `populate` runs against the open store before the level-3 database is closed and the config
 * is saved, e.g. to create projects or memories, or to advance specific features
 * (store.enableProjectBindings(), store.enableSessions(), store.enableEcosystem(), ...) while
 * keeping others -- notably reinforcement and intelligence -- off.
 */
export function legacyConfiguredWorkspace(config: WorkspaceConfig, populate?: (store: MemoryStore) => void): void {
  config.prepare();
  const store = new MemoryStore(config.databasePath);
  try { populate?.(store); }
  finally { store.close(); }
  config.save();
}
