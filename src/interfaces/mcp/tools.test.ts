/** Comprueba que `registerTools` publica las diez herramientas con esquemas ejecutables y manejadores que responden. */
import { expect, test } from "bun:test";
import { registerTools } from "./tools";
import { sdkHarness } from "./__tests__/sdk-harness";

// Las diez herramientas aparecen en tools/list; sus manejadores responden y su esquema de entrada rechaza un límite fuera de rango (51 > 50).
test("registerTools publishes both handler families with executable schemas and callbacks", async () => {
  const h=await sdkHarness((context,server)=>registerTools(server,context.memoryStore,context.projectDirectory));
  try {
    expect((await h.client.listTools()).tools.map(tool=>tool.name).sort()).toEqual([
      "memory_context","memory_current_project","memory_get","memory_history","memory_save","memory_search",
      "memory_session_end","memory_session_start","memory_session_summary","memory_timeline",
    ]);
    expect((await h.call("memory_current_project")).data).toMatchObject({projectId:null});
    expect((await h.call("memory_session_start",{sessionId:"chat"})).data).toMatchObject({sessionId:"chat"});
    expect((await h.client.callTool({name:"memory_search",arguments:{query:"x",limit:51}})).isError).toBe(true);
  } finally {await h.close();}
});
