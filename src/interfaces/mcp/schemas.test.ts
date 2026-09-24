import { expect, test } from "bun:test";
import { toolSchemas } from "./schemas";

test("memory_save accepts bounded metadata fields", () => {
  const save = { title: "T", content: "c", type: "decision" as const };
  expect(toolSchemas.memory_save.parse({ ...save, short: "  corta  ", supersedes: "id-1", affects: ["engram", "shell"] }))
    .toMatchObject({ short: "corta", supersedes: "id-1", affects: ["engram", "shell"] });
  expect(toolSchemas.memory_save.safeParse({ ...save, short: "x".repeat(301) }).success).toBe(false);
  expect(toolSchemas.memory_save.safeParse({ ...save, affects: [] }).success).toBe(false);
  expect(toolSchemas.memory_save.safeParse({ ...save, affects: Array.from({ length: 21 }, (_, i) => `p${i}`) }).success).toBe(false);
});

test("save schema normalizes durable text while preserving exact session identity", () => {
  expect(toolSchemas.memory_save.parse({title:"  Keep  ",content:"  Decision  ",type:"decision",sessionId:"chat-1"})).toEqual({title:"Keep",content:"Decision",type:"decision",sessionId:"chat-1"});
  for (const sessionId of [" chat", "chat ", "chat\n", "x".repeat(201)]) {
    expect(toolSchemas.memory_session_start.safeParse({sessionId}).success).toBe(false);
  }
  expect(toolSchemas.memory_session_start.safeParse({sessionId:"x".repeat(200)}).success).toBe(true);
});
test("search, timeline and context schemas enforce their public bounds", () => {
  expect(toolSchemas.memory_search.safeParse({query:"x",limit:50}).success).toBe(true);
  for (const limit of [0,51,1.5]) expect(toolSchemas.memory_search.safeParse({query:"x",limit}).success).toBe(false);
  const timeline={sessionId:"chat",id:"memory",version:1,before:0,after:20};
  expect(toolSchemas.memory_timeline.parse(timeline)).toEqual(timeline);
  expect(toolSchemas.memory_timeline.safeParse({...timeline,after:21}).success).toBe(false);
  for(const maxBytes of [1024,65536]) expect(toolSchemas.memory_context.safeParse({scope:"shared",maxBytes}).success).toBe(true);
  for(const maxBytes of [1023,65537]) expect(toolSchemas.memory_context.safeParse({maxBytes}).success).toBe(false);
});
test("schemas reject unknown fields, nul bytes and incomplete structured summaries", () => {
  expect(toolSchemas.memory_current_project.safeParse({directory:"/tmp",projectId:"unexpected"}).success).toBe(false);
  expect(toolSchemas.memory_current_project.safeParse({directory:"/tmp\0private"}).success).toBe(false);
  const summary={goal:"Keep decision",instructions:"",discoveries:"",accomplishments:"",nextSteps:"",files:[]};
  expect(toolSchemas.memory_session_summary.safeParse({sessionId:"chat",requestKey:"key",summary}).success).toBe(true);
  expect(toolSchemas.memory_session_summary.safeParse({sessionId:"chat",requestKey:"key",summary:{goal:"Keep"}}).success).toBe(false);
  expect(toolSchemas.memory_session_summary.safeParse({sessionId:"chat",requestKey:"key",summary:{...summary,secret:"hidden"}}).success).toBe(false);
});

test("the ecosystem scope is accepted by the memory tools with strict shapes", () => {
  const save = { title: "Rule", content: "Body", type: "decision" as const };
  expect(toolSchemas.memory_save.parse({ ...save, scope: "ecosystem", groupIntent: "  Applies to every repo of the group  " }))
    .toEqual({ ...save, scope: "ecosystem", groupIntent: "Applies to every repo of the group" });
  expect(toolSchemas.memory_save.safeParse({ ...save, scope: "ecosystem", groupIntent: "" }).success).toBe(false);
  expect(toolSchemas.memory_save.safeParse({ ...save, scope: "ecosystem", groupIntent: "x".repeat(1001) }).success).toBe(false);
  expect(toolSchemas.memory_save.safeParse({ ...save, scope: "ecosystem", groupIntent: "a\0b" }).success).toBe(false);
  expect(toolSchemas.memory_save.safeParse({ ...save, scope: "galaxy" }).success).toBe(false);
  expect(toolSchemas.memory_save.safeParse({ ...save, scope: "ecosystem", groupId: "x" }).success).toBe(false);
  for (const scope of ["all", "project", "shared", "ecosystem"]) expect(toolSchemas.memory_search.safeParse({ query: "x", scope }).success).toBe(true);
  for (const tool of ["memory_get", "memory_history"] as const) {
    for (const scope of ["project", "shared", "ecosystem"]) expect(toolSchemas[tool].safeParse({ id: "m", scope }).success).toBe(true);
    expect(toolSchemas[tool].safeParse({ id: "m", scope: "all" }).success).toBe(false);
  }
  for (const scope of ["shared", "ecosystem"]) expect(toolSchemas.memory_context.safeParse({ scope }).success).toBe(true);
  expect(toolSchemas.memory_context.safeParse({ scope: "project" }).success).toBe(false);
  const summary = { goal: "Keep", instructions: "", discoveries: "", accomplishments: "", nextSteps: "", files: [] };
  expect(toolSchemas.memory_session_summary.safeParse({ sessionId: "chat", requestKey: "k", summary, scope: "ecosystem", groupIntent: "Group wide" }).success).toBe(true);
  expect(toolSchemas.memory_session_summary.safeParse({ sessionId: "chat", requestKey: "k", summary, scope: "shared" }).success).toBe(false);
  expect(toolSchemas.memory_session_summary.safeParse({ sessionId: "chat", requestKey: "k", summary, groupIntent: "x".repeat(1001) }).success).toBe(false);
});
