/** Comprueba las herramientas MCP de `sessions-tools.ts`: sesión, resumen, línea de tiempo y contexto en cada alcance. */
import { expect, setSystemTime, test } from "bun:test";
import { registerMemoryTools } from "./memory-tools";
import { registerSessionTools } from "./sessions-tools";
import { sdkHarness } from "./__tests__/sdk-harness";

// Sin sesión abierta, memory_session_end falla; una vez iniciada, el resumen se puede repetir con la misma requestKey (misma respuesta) y cerrarla marca endedAt.
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
/** Texto exacto de la nota de carpeta sin proyecto (fijado a propósito, sin importarlo del código). */
const UNBOUND_MESSAGE="Esta carpeta todavía no tiene proyecto en Engram, así que no hay recuerdos de proyecto ni de grupo. Se crea al iniciar sesión (memory_session_start) o al guardar.";

/**
 * En una carpeta sin proyecto, memory_context sin scope devuelve el contexto shared más la nota, y con scope ecosystem un contexto vacío de grupo más la nota;
 * scope shared no cambia (sin nota). Existe porque el manual de memoria manda leer el contexto antes de iniciar sesión y eso no debe fallar. Las herramientas
 * que necesitan un proyecto real (memory_session_end, memory_session_summary) siguen dando PROJECT_NOT_BOUND, y ninguna lectura registra la carpeta.
 */
test("memory_context in a folder without a project returns the shared context or an empty group context plus a note", async () => {
  const h=await sdkHarness(registerSessionTools);
  try {
    const shared=h.store.save({scope:"shared",projectId:null,title:"Shared",content:"Global orientation",type:"fact",pinned:true});
    const note={status:"unbound",message:UNBOUND_MESSAGE};
    const sharedContext=(await h.call("memory_context",{scope:"shared"})).data;
    expect(sharedContext).not.toHaveProperty("project");
    expect(sharedContext.pinned.map((row:any)=>row.id)).toEqual([shared.id]);
    expect((await h.call("memory_context")).data).toEqual({...sharedContext,project:note});
    expect((await h.call("memory_context",{scope:"ecosystem"})).data).toEqual({format:1,pinned:[],recent:[],summaries:[],omitted:{pinned:0,recent:0,summaries:0},truncated:false,project:note});
    expect((await h.call("memory_session_end",{sessionId:"chat"})).data.code).toBe("PROJECT_NOT_BOUND");
    expect((await h.call("memory_session_summary",{sessionId:"chat",requestKey:"s",summary:{goal:"x",instructions:"",discoveries:"",accomplishments:"",nextSteps:"",files:[]}})).data.code).toBe("PROJECT_NOT_BOUND");
    expect(h.store.listProjects()).toEqual([]);
  } finally {await h.close();}
});

// memory_timeline usa la versión exacta del dueño (version:2 sin existir da error); memory_context con scope shared funciona sin proyecto vinculado y, sin scope, ya no da error: devuelve la nota de carpeta sin proyecto (antes daba PROJECT_NOT_BOUND; cambiada a propósito en 1.8.5).
test("timeline uses the exact owner/version and context supports shared scope without a binding", async () => {
  const h=await sdkHarness(registerSessionTools);
  try {
    expect((await h.call("memory_context")).data).toMatchObject({project:{status:"unbound",message:UNBOUND_MESSAGE}});
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

// Una sesión iniciada justo después de otra se reporta como paralela; solo tras superar PARALLEL_MINUTES sin cerrarse se reporta como previa; un replay del mismo sessionId no reporta ninguna de las dos.
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
    // Una vez que "first" lleva abierta más de PARALLEL_MINUTES, una sesión nueva la reporta como previa.
    setSystemTime(new Date("2026-01-01T00:31:00.000Z"));
    const third=await h.call("memory_session_start",{sessionId:"third"});
    expect(third.data.previous).toMatchObject({sessionId:"first"});
    expect(third.data).not.toHaveProperty("parallel");
  } finally {setSystemTime(); await h.close();}
});

// sessionNotice (texto legible) solo aparece cuando hay previous o parallel que reportar, y siempre como el último campo del resultado.
test("memory_session_start adds a readable sessionNotice fact only when previous or parallel is reported", async () => {
  const h=await sdkHarness(registerSessionTools);
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    h.store.enableIntelligence();
    const first=await h.call("memory_session_start",{sessionId:"first"});
    expect(first.data).not.toHaveProperty("sessionNotice");
    const second=await h.call("memory_session_start",{sessionId:"second"});
    expect(second.data.sessionNotice).toBe("Another session is open now: first.");
    const replay=await h.call("memory_session_start",{sessionId:"second"});
    expect(replay.data).not.toHaveProperty("sessionNotice");
    setSystemTime(new Date("2026-01-01T00:31:00.000Z"));
    const third=await h.call("memory_session_start",{sessionId:"third"});
    expect(third.data.sessionNotice).toBe("Session first was left open; its last activity was at 2026-01-01T00:00:00.000Z; it saved no summary.");
    expect(Object.keys(third.data).at(-1)).toBe("sessionNotice");
  } finally {setSystemTime(); await h.close();}
});

/** Registra a la vez las herramientas de memoria y de sesión; lo usan las pruebas de este archivo que necesitan memory_save y memory_context/memory_session_summary juntos. */
const both = (context: Parameters<typeof registerMemoryTools>[0]) => { registerMemoryTools(context); registerSessionTools(context); };
/** Crea el primer recuerdo del proyecto y lo une a un grupo de ecosistema recién creado; lo usan las pruebas de scope ecosystem de este archivo. */
async function member(h: Awaited<ReturnType<typeof sdkHarness>>) {
  const seed = (await h.call("memory_save", { title: "Seed", content: "creates the project", type: "fact" })).data;
  h.store.enableEcosystem();
  const group = h.store.createGroup("tienda");
  h.store.bindProjectToGroup(seed.projectId, group.id);
  return { projectId: seed.projectId as string, group };
}

// memory_context con scope ecosystem exige un proyecto en un grupo (GROUP_REQUIRED antes de eso) y devuelve solo el bloque de ecosistema, sin la forma del contexto de proyecto.
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

// El contexto sin scope no lleva bloque de ecosistema hasta que el proyecto se une a un grupo; los recuerdos ecosystem del grupo tampoco entran en su lista "recent" de proyecto.
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

// Un resumen de sesión en scope ecosystem exige groupIntent y un proyecto miembro de un grupo (GROUP_REQUIRED antes de eso); repetirlo con la misma requestKey da la misma respuesta.
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
