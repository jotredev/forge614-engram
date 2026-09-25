import { expect, setSystemTime, test } from "bun:test";
import { registerMemoryTools } from "./memory-tools";
import { registerSessionTools } from "./sessions-tools";
import { sdkHarness } from "./__tests__/sdk-harness";

test("session handlers start, summarize and close the selected project's conversation", async () => {
  const h=await sdkHarness(registerSessionTools);
  try {
    expect((await h.call("memory_session_end",{sessionId:"chat"})).data.code).toBe("PROJECT_NOT_BOUND");
    const started=(await h.call("memory_session_start",{sessionId:"chat"})).data;
    expect(started).toMatchObject({sessionId:"chat"});
    const project=h.store.listProjects()[0]!;
    expect(h.store.getSession(project.projectId,"chat")).not.toBeNull();
    const summary={goal:"Retain decision",instructions:"",discoveries:"",accomplishments:"Saved",nextSteps:"",files:[]};
    const saved=await h.call("memory_session_summary",{sessionId:"chat",summary,requestKey:"summary-one"});
    expect(saved.result.isError).not.toBe(true);
    expect((await h.call("memory_session_summary",{sessionId:"chat",summary,requestKey:"summary-one"})).data).toEqual(saved.data);
    const ended=await h.call("memory_session_end",{sessionId:"chat"});
    expect(ended.result.isError).not.toBe(true);
    expect(h.store.getSession(project.projectId,"chat")?.endedAt).not.toBeNull();
  } finally {await h.close();}
});
test("timeline uses the exact owner/version and context supports shared scope without a binding", async () => {
  const h=await sdkHarness(registerSessionTools);
  try {
    expect((await h.call("memory_context")).data.code).toBe("PROJECT_NOT_BOUND");
    const shared=h.store.save({scope:"shared",projectId:null,title:"Shared",content:"Global orientation",type:"fact",pinned:true});
    const context=await h.call("memory_context",{scope:"shared",compact:true,maxBytes:1024});
    expect(context.result.isError).not.toBe(true);
    expect(context.data).toMatchObject({format:1,pinned:[{id:shared.id,title:"Shared",scope:"shared"}]});
    expect(context.data.pinned[0]).not.toHaveProperty("preview");
    await h.call("memory_session_start",{sessionId:"chat"});
    const project=h.store.listProjects()[0]!;
    const memory=h.store.saveWithSession({projectId:project.projectId,title:"Decision",content:"Keep local",type:"decision"},{sessionId:"chat"}).memory;
    const timeline=await h.call("memory_timeline",{sessionId:"chat",id:memory.id,version:1,before:0,after:0});
    expect(timeline.result.isError).not.toBe(true);
    expect(timeline.data).toMatchObject({sessionId:"chat",focus:{memory:{id:memory.id,version:1}},before:[],after:[]});
    expect((await h.call("memory_timeline",{sessionId:"chat",id:memory.id,version:2})).result.isError).toBe(true);
  } finally {await h.close();}
});

test("memory_session_start reports a parallel session started right after another, and the previous session once it is left open, but neither on replay", async () => {
  const h=await sdkHarness(registerSessionTools);
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    h.store.enableIntelligence();
    await h.call("memory_session_start",{sessionId:"first"});
    const second=await h.call("memory_session_start",{sessionId:"second"});
    expect(second.data).not.toHaveProperty("previous");
    expect(second.data.parallel).toMatchObject([{sessionId:"first"}]);
    const replay=await h.call("memory_session_start",{sessionId:"second"});
    expect(replay.data).not.toHaveProperty("previous");
    expect(replay.data).not.toHaveProperty("parallel");
    // Once "first" has been left open for over PARALLEL_MINUTES, a fresh session reports it as previous.
    setSystemTime(new Date("2026-01-01T00:31:00.000Z"));
    const third=await h.call("memory_session_start",{sessionId:"third"});
    expect(third.data.previous).toMatchObject({sessionId:"first"});
    expect(third.data).not.toHaveProperty("parallel");
  } finally {setSystemTime(); await h.close();}
});

const both = (context: Parameters<typeof registerMemoryTools>[0]) => { registerMemoryTools(context); registerSessionTools(context); };
async function member(h: Awaited<ReturnType<typeof sdkHarness>>) {
  const seed = (await h.call("memory_save", { title: "Seed", content: "creates the project", type: "fact" })).data;
  h.store.enableEcosystem();
  const group = h.store.createGroup("tienda");
  h.store.bindProjectToGroup(seed.projectId, group.id);
  return { projectId: seed.projectId as string, group };
}

test("memory_context on the ecosystem scope needs a group and returns only its block", async () => {
  const h = await sdkHarness(both);
  try {
    await h.call("memory_save", { title: "Seed", content: "creates the project", type: "fact" });
    expect((await h.call("memory_context", { scope: "ecosystem" })).data.code).toBe("GROUP_REQUIRED");
    const { group } = await member(h);
    h.store.save({ scope: "ecosystem", projectId: null, groupId: group.id, title: "Grupo", content: "regla", type: "decision", pinned: true });
    const block = (await h.call("memory_context", { scope: "ecosystem" })).data;
    expect(block).toMatchObject({ format: 1, pinned: [{ title: "Grupo", scope: "ecosystem", groupId: group.id }] });
    expect(block).not.toHaveProperty("ecosystem");
  } finally { await h.close(); }
});

test("memory_context for a project in a group adds the ecosystem block; for anyone else the result is unchanged", async () => {
  const h = await sdkHarness(both);
  try {
    await h.call("memory_save", { title: "Seed", content: "solo proyecto", type: "fact" });
    const before = (await h.call("memory_context")).data;
    expect(Object.keys(before)).not.toContain("ecosystem");
    const { group } = await member(h);
    h.store.save({ scope: "ecosystem", projectId: null, groupId: group.id, title: "Grupo", content: "regla", type: "decision" });
    const after = (await h.call("memory_context")).data;
    expect(after.ecosystem).toMatchObject({ status: "member", group: { id: group.id, name: "tienda" } });
    expect(after.ecosystem.context.recent.map((row: any) => row.title)).toEqual(["Grupo"]);
    expect(after.recent.map((row: any) => row.scope)).not.toContain("ecosystem");
    expect((await h.call("memory_context", { scope: "shared" })).data).not.toHaveProperty("ecosystem");
    expect((await h.call("memory_current_project")).data).toMatchObject({ source: "file", group: { id: group.id, name: "tienda" } });
  } finally { await h.close(); }
});

test("a session summary can be written to the ecosystem scope, with a groupIntent and only for a member", async () => {
  const h = await sdkHarness(both);
  try {
    const summary = { goal: "Share decision", instructions: "", discoveries: "", accomplishments: "Done", nextSteps: "", files: [] };
    await h.call("memory_session_start", { sessionId: "chat" });
    expect((await h.call("memory_session_summary", { sessionId: "chat", summary, requestKey: "s1", scope: "ecosystem", groupIntent: "For the whole group" })).data.code).toBe("GROUP_REQUIRED");
    const { projectId, group } = await member(h);
    expect((await h.call("memory_session_summary", { sessionId: "chat", summary, requestKey: "s1", scope: "ecosystem" })).data.code).toBe("GROUP_INTENT_REQUIRED");
    expect((await h.call("memory_session_summary", { sessionId: "chat", summary, requestKey: "s1", groupIntent: "wrong scope" })).data.code).toBe("INVALID_INPUT");
    const saved = (await h.call("memory_session_summary", { sessionId: "chat", summary, requestKey: "s1", scope: "ecosystem", groupIntent: "For the whole group" })).data;
    expect(saved.memory).toMatchObject({ scope: "ecosystem", groupId: group.id, projectId: null, topicKey: "session/chat/summary" });
    expect(saved.sessionId).toBe("chat");
    expect((await h.call("memory_session_summary", { sessionId: "chat", summary, requestKey: "s1", scope: "ecosystem", groupIntent: "For the whole group" })).data).toEqual(saved);
    expect(h.store.getByTopicInGroup(group.id, "session/chat/summary")?.id).toBe(saved.memory.id);
    expect(h.store.getSession(projectId, "chat")).not.toBeNull();
  } finally { await h.close(); }
});
