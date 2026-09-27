/**
 * Comprueba la sincronización entre la base local y una réplica remota simulada:
 * publicación de cambios, no repetir publicaciones sin cambios, y los rechazos por
 * formato (nivel de sincronización) cuando falta consentimiento o capacidad local.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./memory-store";
import { synchronize, syncWorkspace } from "./synchronization";
import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { PostgresReplica } from "../infrastructure/postgres/replica";
import { emptySnapshot, snapshotHash, type SyncSnapshot } from "../modules/synchronization";

// Sustituto de PostgresReplica que guarda la fotografía (snapshot) en memoria, sin red
// ni sustitución de módulos, para poder observar cuántas veces se publica.
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
// Verifica que un proyecto creado localmente se publica en la réplica y queda anotado
// como punto de encuentro (checkpoint), y que sincronizar de nuevo sin cambios no vuelve a publicar.
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
// Verifica que syncWorkspace falla con SYNC_DISABLED cuando el espacio de trabajo no
// tiene una URL de PostgreSQL configurada, sin llegar a abrir la base local.
test("workspace synchronization rejects disabled PostgreSQL before opening storage", async () => {
  const directory = mkdtempSync(join(tmpdir(),"engram-sync-own-"));
  try {
    const config = new WorkspaceConfig(join(directory,"workspace"));
    config.prepare(); config.save();
    await expect(syncWorkspace(config)).rejects.toMatchObject({code:"SYNC_DISABLED"});
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

// Verifica que subir la réplica al formato 3 (refuerzo) exige la opción upgradeFormat:
// sin ella, se rechaza sin tocar ni la réplica ni la base local; con ella, se publica.
test("format 3 promotion requires consent before remote publication and leaves both sides unchanged on refusal", async () => {
  const store=new MemoryStore(":memory:");
  try {
    store.enableSearchReinforcement();
    store.createProject("Local format 3");
    const replica=new InMemoryReplica();
    const localBefore=store.syncSnapshot();
    const checkpointBefore=store.syncCheckpoint(replica.id);
    await expect(synchronize(store,replica as unknown as PostgresReplica)).rejects.toMatchObject({code:"SYNC_UPGRADE_REQUIRED"});
    expect(replica.publications).toBe(0);
    expect(replica.snapshot).toEqual(emptySnapshot());
    expect(store.syncSnapshot()).toEqual(localBefore);
    expect(store.syncCheckpoint(replica.id)).toEqual(checkpointBefore);

    await synchronize(store,replica as unknown as PostgresReplica,{upgradeFormat:true});
    expect(replica.snapshot.format).toBe(3);
    expect(replica.publications).toBe(1);
  } finally {store.close();}
});

// Verifica que si la réplica remota ya está en formato 3 pero la base local no tiene el
// refuerzo activado, se rechaza con REINFORCEMENT_REQUIRED sin publicar ni cambiar nada local.
test("format 3 remote data is rejected by an unenrolled local store before remote publication", async () => {
  const enrolled=new MemoryStore(":memory:");
  const local=new MemoryStore(":memory:");
  try {
    enrolled.enableSearchReinforcement();
    enrolled.createProject("Remote format 3");
    const replica=new InMemoryReplica();
    replica.snapshot=enrolled.syncSnapshot();
    local.enableSessions();
    local.createProject("Would publish");
    const before=local.syncSnapshot();
    await expect(synchronize(local,replica as unknown as PostgresReplica,{upgradeFormat:true})).rejects.toMatchObject({code:"REINFORCEMENT_REQUIRED"});
    expect(replica.publications).toBe(0);
    expect(local.syncSnapshot()).toEqual(before);
    expect(local.syncCheckpoint(replica.id)).toEqual(emptySnapshot());
  } finally {enrolled.close();local.close();}
});

// Verifica que subir directamente de formato 2 a formato 3 también exige upgradeFormat,
// igual que subir desde el formato inicial.
test("promoting a format 2 remote to format 3 also requires explicit consent", async () => {
  const store=new MemoryStore(":memory:");
  try {
    store.enableSearchReinforcement();
    const replica=new InMemoryReplica();
    replica.snapshot={format:2,projects:[],memories:[],sessions:[],sessionEntries:[],sessionSummaries:[]};
    const before=structuredClone(replica.snapshot);
    await expect(synchronize(store,replica as unknown as PostgresReplica)).rejects.toMatchObject({code:"SYNC_UPGRADE_REQUIRED"});
    expect(replica.snapshot).toEqual(before);
    expect(replica.publications).toBe(0);
    expect(store.syncCheckpoint(replica.id)).toEqual(emptySnapshot());

    await synchronize(store,replica as unknown as PostgresReplica,{upgradeFormat:true});
    expect((replica.snapshot as SyncSnapshot).format).toBe(3);
    expect(replica.publications).toBe(1);
  } finally {store.close();}
});
