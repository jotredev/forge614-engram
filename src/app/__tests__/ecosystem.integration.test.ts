import { expect, test } from "bun:test";
import { MemoryStore } from "../memory-store";

function enrolled(): MemoryStore {
  const store = new MemoryStore(":memory:");
  store.enableProjectBindings(); store.enableEcosystem();
  return store;
}

test("the store exposes groups, membership and identity events", () => {
  const store = enrolled();
  try {
    expect(store.ecosystemEnabled()).toBe(true);
    const project = store.createProject("Frontend");
    const group = store.createGroup("tienda");
    expect(store.bindProjectToGroup(project.projectId, group.id)).toEqual({ group, changed: true });
    expect(store.groupOfProject(project.projectId)).toEqual({ group, source: "command" });
    expect(store.listGroups()).toEqual([{ ...group, projects: [{ projectId: project.projectId, name: "Frontend" }] }]);
    expect(store.findGroups("tienda")).toEqual([group]);
    expect(store.getGroup(group.id)).toEqual(group);
    expect(store.renameGroup(group.id, "mi-tienda").name).toBe("mi-tienda");
    expect(store.unbindProject(project.projectId)).toBe(true);
    expect(store.identityEvents(project.projectId).map(event => event.action)).toEqual(["GROUP_BOUND", "GROUP_UNBOUND"]);
  } finally { store.close(); }
});

test("group-scoped methods read and write ecosystem memories without touching existing signatures", () => {
  const store = enrolled();
  try {
    const project = store.createProject("Frontend");
    const group = store.createGroup("tienda");
    store.bindProjectToGroup(project.projectId, group.id);
    const saved = store.save({ scope: "ecosystem", projectId: null, groupId: group.id, title: "Contrato", content: "el contrato de la API vive aquí", type: "decision", topicKey: "api" });
    expect(store.getInGroup(group.id, saved.id)?.groupId).toBe(group.id);
    expect(store.getByTopicInGroup(group.id, "api")?.id).toBe(saved.id);
    expect(store.historyInGroup(group.id, saved.id)).toHaveLength(1);
    expect(store.getVersionInGroup(group.id, saved.id, 1)?.memory.title).toBe("Contrato");
    expect(store.searchInGroup(group.id, "contrato").map(result => result.memory.id)).toEqual([saved.id]);
    expect(store.searchPreviewsInGroup(group.id, "contrato")[0]!.memory.scope).toBe("ecosystem");
    expect(store.contextForGroup(group.id).recent.map(row => row.title)).toEqual(["Contrato"]);
    // The existing project-scoped methods reach it through the group of the project.
    expect(store.search(project.projectId, "contrato", 10, "all").map(result => result.memory.id)).toEqual([saved.id]);
    expect(store.search(project.projectId, "contrato", 10, "ecosystem").map(result => result.memory.id)).toEqual([saved.id]);
    expect(store.get(null, saved.id)).toBeNull();
    expect(store.archiveInGroup(group.id, saved.id).state).toBe("archived");
    expect(store.searchInGroup(group.id, "contrato")).toEqual([]);
    expect(store.restoreInGroup(group.id, saved.id).state).toBe("active");
  } finally { store.close(); }
});

test("a store without the ecosystem level answers groups as empty and refuses to write them", () => {
  const store = new MemoryStore(":memory:");
  try {
    store.enableProjectBindings();
    expect(store.ecosystemEnabled()).toBe(false);
    expect(store.listGroups()).toEqual([]);
    expect(store.findGroups("nada")).toEqual([]);
    expect(store.groupOfProject(store.createProject("Solo").projectId)).toBeNull();
    expect(() => store.createGroup("tienda")).toThrow(expect.objectContaining({ code: "MIGRATION_REQUIRED" }));
  } finally { store.close(); }
});
