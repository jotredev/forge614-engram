import { expect, test } from "bun:test";
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
