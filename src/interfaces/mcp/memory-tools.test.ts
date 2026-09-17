import { expect, test } from "bun:test";
import { registerMemoryTools } from "./memory-tools";
import { sdkHarness } from "./__tests__/sdk-harness";

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
