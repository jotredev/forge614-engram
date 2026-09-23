import { expect, test } from "bun:test";
import { applySnapshot, checkpoint, exportSnapshot } from "./snapshots";
import { createProject } from "./projects";
import { bindProjectToGroup, createGroup } from "./ecosystem-groups";
import { enableEcosystem, enableProjectBindings, enableSearchReinforcement, enableSessionLifecycle, enableSynchronization } from "./schema";
import { save, saveWithSession, startSession } from "./writes";
import { withDatabase } from "../__test-support__/fixtures";

test("snapshot application persists data and checkpoint atomically and refuses stale local state", () => withDatabase(db => {
  enableSynchronization(db);
  const empty = { format: 1 as const, projects: [], memories: [] };
  const next = { ...empty, projects: [{ projectId: "11111111-1111-4111-8111-111111111111", name: "Remote", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }] };
  expect(checkpoint(db, "remote")).toEqual(empty);
  applySnapshot(db, empty, next, "remote");
  expect(exportSnapshot(db)).toEqual(next);
  expect(checkpoint(db, "remote")).toEqual(next);
  createProject(db, "Local");
  expect(() => applySnapshot(db, next, next, "remote")).toThrow(expect.objectContaining({ code: "SYNC_LOCAL_CHANGED" }));
  expect(exportSnapshot(db).projects.map(p => p.name).sort()).toEqual(["Local", "Remote"]);
  expect(checkpoint(db, "remote")).toEqual(next);
}));

test("snapshot format follows explicit SQLite capabilities without silently upgrading older schemas", () => {
  withDatabase(db => {
    expect(exportSnapshot(db).format).toBe(1);
    enableSynchronization(db);
    expect(exportSnapshot(db).format).toBe(1);
  });
  withDatabase(db => {
    enableProjectBindings(db);
    expect(exportSnapshot(db).format).toBe(1);
  });
  withDatabase(db => {
    enableSessionLifecycle(db);
    expect(exportSnapshot(db).format).toBe(2);
  });
  withDatabase(db => {
    enableSearchReinforcement(db);
    const snapshot = exportSnapshot(db);
    expect(snapshot.format).toBe(3);
    if (snapshot.format !== 3) throw new Error("expected format 3");
    expect(snapshot.confirmations).toEqual([]);
    expect(snapshot.confirmationRequests).toEqual([]);
  });
});

test("format 3 export parses stable responses and orders requests by owner namespace and key", () => withDatabase(db => {
  enableSearchReinforcement(db);
  const project = createProject(db, "Ordering");
  const one = save(db,{projectId:project.projectId,title:"One",content:"first",type:"fact"});
  const two = save(db,{projectId:project.projectId,title:"Two",content:"second",type:"fact"});
  const ordered = [one,two].sort((a,b)=>a.id.localeCompare(b.id));
  const lower=ordered[0]!,higher=ordered[1]!;
  save(db,{projectId:project.projectId,title:lower.title,content:lower.content,type:lower.type,requestKey:"z-key"});
  save(db,{projectId:project.projectId,title:higher.title,content:higher.content,type:higher.type,requestKey:"a-key"});
  for(const [title,content,requestKey] of [
    ["Quote","quote",'quote"key'],["Slash","slash","slash\\key"],["Private","private","\uE000-key"],["Supplementary","supplementary","𐀀-key"],
  ] as const) {
    save(db,{projectId:project.projectId,title,content,type:"fact"});
    save(db,{projectId:project.projectId,title,content,type:"fact",requestKey});
  }

  const snapshot = exportSnapshot(db);
  expect(snapshot.format).toBe(3);
  if (snapshot.format !== 3) throw new Error("expected format 3");
  expect(snapshot.confirmationRequests.map(request=>request.requestKey)).toEqual([
    "a-key",'quote"key',"slash\\key","z-key","𐀀-key","\uE000-key",
  ]);
  expect(snapshot.confirmationRequests.every(request=>typeof request.response === "object")).toBe(true);
  expect(snapshot.confirmations.map(item=>item.confirmationId)).toEqual(
    [...snapshot.confirmations].map(item=>item.confirmationId).sort(),
  );
}));

test("format 3 export uses reconciliation identity order for Unicode sessions and multi-digit entry versions", () => withDatabase(db => {
  enableSearchReinforcement(db);
  const project=createProject(db,"Identity order");
  startSession(db,project.projectId,"\uE000-session");
  startSession(db,project.projectId,"𐀀-session");
  let result=saveWithSession(db,{projectId:project.projectId,title:"History",content:"v1",type:"fact",topicKey:"history"},{sessionId:"𐀀-session"});
  for(let version=2;version<=10;version++) {
    result=saveWithSession(db,{projectId:project.projectId,title:"History",content:`v${version}`,type:"fact",topicKey:"history",expectedVersion:version-1},{sessionId:"𐀀-session"});
  }
  expect(result.memory.version).toBe(10);

  const snapshot=exportSnapshot(db);
  expect(snapshot.format).toBe(3);
  if(snapshot.format!==3) throw new Error("expected format 3");
  expect(snapshot.sessions.map(session=>session.sessionId)).toEqual(["𐀀-session","\uE000-session"]);
  expect(snapshot.sessionEntries.map(entry=>entry.version)).toEqual([10,1,2,3,4,5,6,7,8,9]);
}));

test("format 3 apply is enrolled-only, transactional, and idempotent", () => {
  let next!: ReturnType<typeof exportSnapshot>;
  withDatabase(source => {
    enableSearchReinforcement(source);
    const project = createProject(source,"Source");
    const memory = save(source,{projectId:project.projectId,title:"Transport",content:"immutable",type:"decision",topicKey:"transport",requestKey:"create"});
    save(source,{projectId:project.projectId,title:memory.title,content:memory.content,type:memory.type,topicKey:memory.topicKey!,expectedVersion:1,requestKey:"confirm"});
    next=exportSnapshot(source);
  });

  withDatabase(target => {
    enableSessionLifecycle(target);
    const before=exportSnapshot(target);
    expect(()=>applySnapshot(target,before,next,"remote")).toThrow(expect.objectContaining({code:"REINFORCEMENT_REQUIRED"}));
    expect(exportSnapshot(target)).toEqual(before);
    expect(checkpoint(target,"remote")).toEqual({format:1,projects:[],memories:[]});
  });

  withDatabase(target => {
    enableSearchReinforcement(target);
    const before=exportSnapshot(target);
    applySnapshot(target,before,next,"remote");
    expect(exportSnapshot(target)).toEqual(next);
    expect(checkpoint(target,"remote")).toEqual(next);
    applySnapshot(target,next,next,"remote");
    expect(exportSnapshot(target)).toEqual(next);

    if(next.format!==3) throw new Error("expected format 3");
    const conflicting=structuredClone(next);
    conflicting.confirmations[0]!.recordedAt=new Date(Date.parse(conflicting.confirmations[0]!.recordedAt)+1).toISOString();
    expect(()=>applySnapshot(target,next,conflicting,"remote")).toThrow(expect.objectContaining({code:"SYNC_CONFLICT"}));
    expect(exportSnapshot(target)).toEqual(next);
    expect(checkpoint(target,"remote")).toEqual(next);
  });
});

test("synchronization keeps working below and at the ecosystem level, and stops explicitly once ecosystem memories exist", () => withDatabase(db => {
  enableSynchronization(db); enableProjectBindings(db);
  const project = createProject(db, "Frontend");
  save(db, { scope: "project", projectId: project.projectId, title: "Nota", content: "local", type: "fact" });
  const before = exportSnapshot(db);
  enableEcosystem(db);
  const group = createGroup(db, "tienda");
  bindProjectToGroup(db, project.projectId, group.id, "command");
  expect(exportSnapshot(db)).toEqual(before);
  const shared = save(db, { scope: "shared", projectId: null, title: "Global", content: "todos", type: "fact" });
  expect(exportSnapshot(db).memories.map(bundle => bundle.memory.id)).toContain(shared.id);
  save(db, { scope: "ecosystem", projectId: null, groupId: group.id, title: "Grupo", content: "regla", type: "decision" });
  expect(() => exportSnapshot(db)).toThrow(expect.objectContaining({ code: "SYNC_ECOSYSTEM_UNSUPPORTED" }));
  const empty = { format: 1 as const, projects: [], memories: [] };
  expect(() => applySnapshot(db, empty, empty, "remote")).toThrow(expect.objectContaining({ code: "SYNC_ECOSYSTEM_UNSUPPORTED" }));
  // Nothing was written by the refused attempt.
  expect(db.query("SELECT count(*) AS n FROM sync_checkpoints").get()).toEqual({ n: 0 });
}));
