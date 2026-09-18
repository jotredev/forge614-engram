import { expect, test } from "bun:test";
import { MemoryStore } from "./memory-store";

  test("store facade searches shared and project memories by default and honors a project-only scope", () => {
    const store = new MemoryStore(":memory:");
    try {
      const project = store.createProject("Facade");
      const local = store.save({projectId:project.projectId,title:"Topic",content:"searchable",type:"fact"});
      const shared = store.save({scope:"shared",projectId:null,title:"Topic",content:"searchable",type:"fact"});
      expect(store.search(project.projectId,"searchable").map(item => item.memory.id).sort()).toEqual([local.id,shared.id].sort());
      expect(store.search(project.projectId,"searchable",10,"project").map(item => item.memory.id)).toEqual([local.id]);
      store.archive(project.projectId,local.id);
      expect(store.search(project.projectId,"searchable",10,"project")).toEqual([]);
      store.restore(project.projectId,local.id);
      expect(store.search(project.projectId,"searchable",10,"project").map(item => item.memory.id)).toEqual([local.id]);
    } finally { store.close(); }
  });

test("closing a store is idempotent and prevents subsequent operations", () => {
  const store = new MemoryStore(":memory:");
  store.createProject("Before close");
  store.close();
  expect(() => store.close()).not.toThrow();
  expect(() => store.listProjects()).toThrow();
});

test("store facade explicitly reports and enables search reinforcement", () => {
  const store=new MemoryStore(":memory:");
  try {
    expect(store.reinforcementEnabled()).toBe(false);
    store.enableSearchReinforcement();
    expect(store.reinforcementEnabled()).toBe(true);
  } finally { store.close(); }
});

test("store facade returns control-center summaries from its SQLite connection", () => {
  const store = new MemoryStore(":memory:");
  try {
    const project = store.createProject("Facade summary");
    store.save({projectId:project.projectId, title:"Private title", content:"Private content", type:"fact"});
    expect(store.controlCenter()).toEqual({
      capabilities:{schema:3, assistantIntegration:false, sessions:false, reinforcement:false},
      projects:[{...project, bindings:[], memories:{active:1, archived:0, lastUpdatedAt:expect.any(String)}}],
      shared:{active:0, archived:0, lastUpdatedAt:null},
    });
  } finally { store.close(); }
});
