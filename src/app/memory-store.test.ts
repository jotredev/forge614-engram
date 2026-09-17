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
