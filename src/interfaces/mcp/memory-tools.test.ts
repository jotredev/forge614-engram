import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIELD_DESCRIPTIONS } from "../../modules/memory-protocol";
import { registerMemoryTools } from "./memory-tools";

test("memory_save passes metadata through and memory_get returns it with marks at level 11", async () => {
  const h=await sdkHarness(registerMemoryTools);
  try {
    h.store.enableIntelligence();
    const old=(await h.call("memory_save",{title:"Vieja",content:"usar A",type:"decision"})).data;
    const fresh=(await h.call("memory_save",{title:"Nueva",content:"usar B",type:"decision",short:"B en vez de A",supersedes:old.id,affects:["shell","engram"]})).data;
    expect((await h.call("memory_get",{id:fresh.id})).data).toMatchObject({meta:{short:"B en vez de A",affects:["engram","shell"]},marks:[]});
    expect((await h.call("memory_get",{id:old.id})).data).toMatchObject({meta:{supersededBy:fresh.id},marks:["superseded"]});
    expect((await h.call("memory_save",{title:"Clave",content:["pass","word = ","hunter2hunter2"].join(""),type:"fact"})).data.code).toBe("SECRET_REJECTED");
  } finally {await h.close();}
});
import { sdkHarness } from "./__tests__/sdk-harness";

test("memory_save writes the ecosystem status note only from the group's source project (level 11)", async () => {
  const h=await sdkHarness(registerMemoryTools);
  try {
    const seed=(await h.call("memory_save",{title:"Seed",content:"creates the project",type:"fact"})).data;
    h.store.enableIntelligence();
    const group=h.store.createGroup("tienda");
    h.store.bindProjectToGroup(seed.projectId,group.id);
    const note={scope:"ecosystem",groupIntent:"status of the whole group",title:"Estado actual",content:"Frente: T4.",type:"fact",topicKey:"ecosystem/estado-actual"};
    expect((await h.call("memory_save",note)).data.code).toBe("ECOSYSTEM_STATUS_FORBIDDEN");
    h.store.setGroupSource(group.id,seed.projectId);
    expect((await h.call("memory_save",note)).data).toMatchObject({scope:"ecosystem",topicKey:"ecosystem/estado-actual",pinned:true});
  } finally {await h.close();}
});

test("memory handlers resolve projects, save revisions and expose owner-scoped previews and history", async () => {
  const h=await sdkHarness(registerMemoryTools);
  try {
    expect((await h.call("memory_current_project")).data).toMatchObject({projectId:null,source:"unbound"});
    expect((await h.call("memory_search",{query:"decision"})).data.code).toBe("PROJECT_NOT_BOUND");
    const saved=(await h.call("memory_save",{title:"Decision",content:"SQLite decision",type:"decision",topicKey:"storage",requestKey:"one",pinned:true})).data;
    expect(saved).toMatchObject({title:"Decision",content:"SQLite decision",version:1,scope:"project",pinned:true});
    expect(h.store.get(saved.projectId,saved.id)?.content).toBe("SQLite decision");
    const updated=(await h.call("memory_save",{title:"Decision",content:"Revised decision",type:"decision",topicKey:"storage",expectedVersion:1,requestKey:"two"})).data;
    expect(updated).toMatchObject({id:saved.id,version:2});
    expect((await h.call("memory_get",{id:saved.id,version:1})).data).toMatchObject({memory:{content:"SQLite decision",version:1},currentVersion:2});
    expect((await h.call("memory_history",{id:saved.id})).data.map((x:any)=>x.version)).toEqual([1,2]);
    expect((await h.call("memory_search",{query:"Revised",limit:1,scope:"project"})).data).toMatchObject({format:2,results:[{memory:{id:saved.id,version:2,preview:"Revised decision"}}]});
    expect((await h.call("memory_get",{id:saved.id,scope:"shared"})).data.code).toBe("NOT_FOUND");
  } finally {await h.close();}
});
test("shared saves require explicit intent and paired session ownership without resolving a project", async () => {
  const h=await sdkHarness(registerMemoryTools);
  try {
    const save={title:"Shared",content:"Global preference",type:"preference",scope:"shared"};
    expect((await h.call("memory_save",save)).data.code).toBe("SHARED_INTENT_REQUIRED");
    expect((await h.call("memory_save",{...save,globalIntent:"User requested global",sessionId:"chat"})).data.code).toBe("INVALID_INPUT");
    expect((await h.call("memory_save",{...save,scope:"project",globalIntent:"Wrong scope"})).data.code).toBe("INVALID_INPUT");
    const saved=(await h.call("memory_save",{...save,globalIntent:"User requested global"})).data;
    expect(saved).toMatchObject({scope:"shared",projectId:null});
    expect((await h.call("memory_search",{scope:"shared",query:"Global"})).data.results).toHaveLength(1);
    expect((await h.call("memory_get",{scope:"shared",id:saved.id})).data.memory.content).toBe("Global preference");
    expect(h.store.listProjects()).toEqual([]);
  } finally {await h.close();}
});

test("enrolled MCP duplicate saves reinforce one project memory without creating a version or leaking another owner", async () => {
  const h=await sdkHarness(registerMemoryTools);
  try {
    h.store.enableSearchReinforcement();
    const first=(await h.call("memory_save",{title:"Ownership",content:"Keep isolated",type:"decision",topicKey:"owner",requestKey:"project-create"})).data;
    const other=h.store.createProject("Other");
    const foreign=h.store.save({projectId:other.projectId,title:"Ownership",content:"Keep isolated",type:"decision",topicKey:"owner",requestKey:"other-create"});
    const repeated=(await h.call("memory_save",{title:"Ownership",content:"Keep isolated",type:"decision",topicKey:"owner",expectedVersion:1,requestKey:"project-observation"})).data;
    expect(repeated).toMatchObject({id:first.id,projectId:first.projectId,version:1});
    expect(repeated.id).not.toBe(foreign.id);
    expect(h.store.history(first.projectId,first.id)).toHaveLength(1);
    expect(h.store.search(first.projectId,"isolated",10,"project")[0]).toMatchObject({
      memory:{id:first.id,version:1},explanation:{reinforcement:{duplicateCount:1}},
    });
  } finally {await h.close();}
});

async function grouped(h: Awaited<ReturnType<typeof sdkHarness>>, name = "tienda") {
  const first = (await h.call("memory_save", { title: "Seed", content: "creates the project", type: "fact" })).data;
  h.store.enableEcosystem();
  const group = h.store.createGroup(name);
  h.store.bindProjectToGroup(first.projectId, group.id);
  return { projectId: first.projectId as string, group };
}

test("ecosystem saves need a truthful groupIntent and a project that belongs to a group", async () => {
  const h = await sdkHarness(registerMemoryTools);
  try {
    const save = { title: "Rule", content: "Group wide rule", type: "decision", scope: "ecosystem", topicKey: "rule" };
    expect((await h.call("memory_save", save)).data.code).toBe("GROUP_INTENT_REQUIRED");
    expect((await h.call("memory_save", { ...save, groupIntent: "Applies to every repo" })).data.code).toBe("PROJECT_NOT_BOUND");
    const { projectId, group } = await grouped(h);
    expect((await h.call("memory_save", { ...save, groupIntent: "Applies to every repo", globalIntent: "wrong" })).data.code).toBe("INVALID_INPUT");
    expect((await h.call("memory_save", { ...save, groupIntent: "Applies to every repo", sessionProjectId: projectId })).data.code).toBe("INVALID_INPUT");
    expect((await h.call("memory_save", { title: "P", content: "c", type: "fact", groupIntent: "wrong scope" })).data.code).toBe("INVALID_INPUT");
    expect((await h.call("memory_save", { title: "S", content: "c", type: "fact", scope: "shared", globalIntent: "g", groupIntent: "also" })).data.code).toBe("INVALID_INPUT");
    const saved = (await h.call("memory_save", { ...save, groupIntent: "Applies to every repo" })).data;
    expect(saved).toMatchObject({ scope: "ecosystem", projectId: null, groupId: group.id, version: 1 });
    expect(h.store.getInGroup(group.id, saved.id)?.content).toBe("Group wide rule");
    const updated = (await h.call("memory_save", { ...save, content: "Revised rule", groupIntent: "Applies to every repo", expectedVersion: 1 })).data;
    expect(updated).toMatchObject({ id: saved.id, version: 2 });
    const loose = h.store.createProject("Loose");
    expect(h.store.groupOfProject(loose.projectId)).toBeNull();
  } finally { await h.close(); }
});

test("a project outside any group cannot save, search or read the ecosystem scope", async () => {
  const h = await sdkHarness(registerMemoryTools);
  try {
    await h.call("memory_save", { title: "Seed", content: "creates the project", type: "fact" });
    const intent = { groupIntent: "Applies to every repo" };
    expect((await h.call("memory_save", { title: "R", content: "c", type: "fact", scope: "ecosystem", ...intent })).data.code).toBe("GROUP_REQUIRED");
    expect((await h.call("memory_search", { query: "anything", scope: "ecosystem" })).data.code).toBe("GROUP_REQUIRED");
    expect((await h.call("memory_get", { id: "x", scope: "ecosystem" })).data.code).toBe("GROUP_REQUIRED");
    expect((await h.call("memory_history", { id: "x", scope: "ecosystem" })).data.code).toBe("GROUP_REQUIRED");
  } finally { await h.close(); }
});

test("ecosystem memories are searched, read and listed through the group of the current project", async () => {
  const h = await sdkHarness(registerMemoryTools);
  try {
    const { group } = await grouped(h);
    const intent = { groupIntent: "Applies to every repo" };
    const saved = (await h.call("memory_save", { title: "Deploy", content: "grupo despliegue", type: "procedure", scope: "ecosystem", topicKey: "deploy", ...intent })).data;
    h.store.save({ scope: "shared", projectId: null, title: "Deploy", content: "compartida despliegue", type: "procedure", topicKey: "deploy" });
    const eco = (await h.call("memory_search", { query: "despliegue", scope: "ecosystem" })).data;
    expect(eco).toMatchObject({ format: 2, results: [{ memory: { id: saved.id, scope: "ecosystem", groupId: group.id } }] });
    expect((await h.call("memory_search", { query: "despliegue" })).data.results.map((r: any) => r.memory.scope)).toEqual(["ecosystem"]);
    expect((await h.call("memory_get", { id: saved.id, scope: "ecosystem" })).data.memory).toMatchObject({ id: saved.id, groupId: group.id });
    expect((await h.call("memory_get", { id: saved.id })).data.code).toBe("NOT_FOUND");
    expect((await h.call("memory_history", { id: saved.id, scope: "ecosystem" })).data.map((x: any) => x.version)).toEqual([1]);
    expect((await h.call("memory_current_project")).data).toMatchObject({ source: "file", group: { id: group.id, name: "tienda" } });
  } finally { await h.close(); }
});

test("the first tool call that upgrades the base carries the notice, and only that one", async () => {
  const h = await sdkHarness(registerMemoryTools);
  try {
    mkdirSync(join(h.directory, ".forge614"), { recursive: true });
    writeFileSync(join(h.directory, ".forge614", "project.json"), JSON.stringify({ schemaVersion: 1, project: { id: crypto.randomUUID(), name: "clon" }, ecosystem: { id: crypto.randomUUID(), name: "tienda" } }));
    const saved = (await h.call("memory_save", { title: "Primera", content: "en un clon con grupo", type: "fact" })).data;
    expect(saved.notices).toEqual([expect.objectContaining({ code: "DATABASE_MIGRATED" })]);
    const again = (await h.call("memory_save", { title: "Segunda", content: "ya migrada", type: "fact" })).data;
    expect(again.notices).toBeUndefined();
    expect((await h.call("memory_current_project")).data.notices).toBeUndefined();
  } finally { await h.close(); }
});
test("memory_save reports look-alikes of a new memory at level 11 and memory_search finds natural questions", async () => {
  const h=await sdkHarness(registerMemoryTools);
  try {
    h.store.enableIntelligence();
    const cause=(await h.call("memory_save",{title:"Bun 1.3.8 se atora en Linux",content:"La causa del cuelgue de CI es Bun 1.3.8 al cargar módulos en Linux; Bun 1.3.9 pasa.",type:"decision"})).data;
    expect(cause).not.toHaveProperty("similar");
    const fix=(await h.call("memory_save",{title:"Bun 1.4.2 fijado como versión única",content:"Todos los nodos fijan Bun 1.4.2; la 1.3.8 se atoraba en Linux al cargar módulos.",type:"decision"})).data;
    expect(fix.similar.map((candidate:any)=>candidate.id)).toEqual([cause.id]);
    const found=(await h.call("memory_search",{query:"qué versión de bun usamos",limit:3})).data;
    expect(found.results.map((result:any)=>[result.memory.id,result.explanation.mode])).toEqual([[fix.id,"hybrid"]]);
  } finally {await h.close();}
});

test("tools/list publishes the manual's field descriptions for memory_save and memory_search", async () => {
  const h=await sdkHarness(registerMemoryTools);
  try {
    const tools=(await h.client.listTools()).tools;
    const fields=(name:string)=>tools.find(tool=>tool.name===name)!.inputSchema.properties as Record<string,{description?:string}>;
    const save=fields("memory_save");
    for (const field of ["directory","scope","globalIntent","groupIntent","title","content","type","topicKey","pinned","expectedVersion","requestKey","short","supersedes","affects","sessionId","sessionProjectId"] as const) {
      expect(save[field]?.description).toBe(FIELD_DESCRIPTIONS[field]);
    }
    expect(fields("memory_search").query?.description).toBe(FIELD_DESCRIPTIONS.query);
    expect(fields("memory_search").scope?.description).toBe(FIELD_DESCRIPTIONS.searchScope);
    expect(fields("memory_get").id?.description).toBe(FIELD_DESCRIPTIONS.id);
  } finally {await h.close();}
});
