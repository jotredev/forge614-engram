/**
 * Comprueba la fachada pública de MemoryStore: búsqueda combinando alcance compartido y de
 * proyecto, cierre idempotente, activar refuerzo e inteligencia, y búsqueda por topicKey.
 */
import { expect, test } from "bun:test";
import { MemoryStore } from "./memory-store";

  // Verifica que buscar sin alcance trae memorias compartidas y de proyecto, y que pedir "project" solo trae las del proyecto (y respeta archivar/restaurar).
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

// Verifica que cerrar dos veces no lanza error, pero usar la base tras cerrarla sí falla.
test("closing a store is idempotent and prevents subsequent operations", () => {
  const store = new MemoryStore(":memory:");
  store.createProject("Before close");
  store.close();
  expect(() => store.close()).not.toThrow();
  expect(() => store.listProjects()).toThrow();
});

// Verifica que el refuerzo de búsqueda empieza desactivado y que activarlo lo deja activo.
test("store facade explicitly reports and enables search reinforcement", () => {
  const store=new MemoryStore(":memory:");
  try {
    expect(store.reinforcementEnabled()).toBe(false);
    store.enableSearchReinforcement();
    expect(store.reinforcementEnabled()).toBe(true);
  } finally { store.close(); }
});

// Verifica que activar inteligencia migra la base (backup null porque ya estaba al día) y queda activada.
test("memory store enrolls intelligence explicitly", () => {
  const store = new MemoryStore(":memory:");
  try {
    expect(store.intelligenceEnabled()).toBe(false);
    expect(store.enableIntelligence()).toEqual({ migrated: true, backup: null });
    expect(store.intelligenceEnabled()).toBe(true);
  } finally { store.close(); }
});

// Verifica que buscar por topicKey encuentra la memoria del proyecto dueño y no la ve un scope distinto (null).
test("store facade exposes owner-scoped topic lookups for resumable work", () => {
  const store = new MemoryStore(":memory:");
  try {
    const project = store.createProject("Atlas");
    const saved = store.save({ projectId: project.projectId, title: "Module", content: "completed", type: "procedure", topicKey: "atlas:module" });
    expect(store.getByTopic(project.projectId, "atlas:module")).toMatchObject({ id: saved.id, content: "completed" });
    expect(store.getByTopic(null, "atlas:module")).toBeNull();
  } finally { store.close(); }
});
