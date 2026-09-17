import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./memory-store";
import { synchronize, syncWorkspace } from "./synchronization";
import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { PostgresReplica } from "../infrastructure/postgres/replica";
import { emptySnapshot, snapshotHash, type SyncSnapshot } from "../modules/synchronization";

// An instance-local replica boundary; no network or module replacement.
class InMemoryReplica {
  readonly id = "test-replica";
  snapshot: SyncSnapshot = emptySnapshot();
  publications = 0;
  async read() { return {snapshot:this.snapshot,hash:snapshotHash(this.snapshot)}; }
  async publish(expected:string,next:SyncSnapshot) {
    if (expected !== snapshotHash(this.snapshot)) throw new Error("Stale CAS");
    this.snapshot = next;
    this.publications++;
    return snapshotHash(next);
  }
}
test("synchronization publishes local additions and checkpoints them without republishing unchanged state", async () => {
  const store = new MemoryStore(":memory:");
  try {
    store.enableSync();
    const project = store.createProject("Local");
    const replica = new InMemoryReplica();
    expect(await synchronize(store,replica as unknown as PostgresReplica)).toEqual({synchronized:true,projects:1,memories:0});
    expect(replica.snapshot.projects).toEqual([project]);
    expect(store.syncCheckpoint(replica.id).projects).toEqual([project]);
    await synchronize(store,replica as unknown as PostgresReplica);
    expect(replica.publications).toBe(1);
  } finally { store.close(); }
});
test("workspace synchronization rejects disabled PostgreSQL before opening storage", async () => {
  const directory = mkdtempSync(join(tmpdir(),"engram-sync-own-"));
  try {
    const config = new WorkspaceConfig(join(directory,"workspace"));
    config.prepare(); config.save();
    await expect(syncWorkspace(config)).rejects.toMatchObject({code:"SYNC_DISABLED"});
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
