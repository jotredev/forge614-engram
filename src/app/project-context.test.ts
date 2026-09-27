/**
 * Comprueba la resolución de contexto de proyecto: validación de entrada, vínculo
 * explícito con sesión, y los avisos de sesión previa o paralela al iniciar una nueva.
 */
import { expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./memory-store";
import { bindProjectContext, resolveProjectContext, saveProjectMemoryWithSession, startProjectSession, startProjectSessionWithNotices } from "./project-context";

// Verifica que un valor de "create" que no es booleano se rechaza con INVALID_INPUT antes de tocar el disco o crear proyectos.
test("context rejects a nonboolean create flag before directory discovery", () => {
  const store = new MemoryStore(":memory:");
  try {
    expect(() => resolveProjectContext(store,"/missing",1 as unknown as boolean)).toThrow(expect.objectContaining({code:"INVALID_INPUT"}));
    expect(store.listProjects()).toEqual([]);
  } finally { store.close(); }
});
// Verifica que ligar explícitamente una carpeta a un proyecto se respeta al guardar con sesión, y que la carpeta se reporta en su forma canónica (resuelta con realpath).
test("explicit binding and session save preserve the selected project and canonical runtime directory", () => {
  const directory = mkdtempSync(join(tmpdir(),"engram-context-own-"));
  const store = new MemoryStore(":memory:");
  try {
    store.enableSessions();
    const project = store.createProject("Selected");
    expect(bindProjectContext(store,directory,project.projectId)).toEqual({projectId:project.projectId,directory:realpathSync(directory),source:"binding"});
    startProjectSession(store,directory,"conversation");
    const result = saveProjectMemoryWithSession(store,directory,{title:"Choice",content:"Preserve identity",type:"fact"},{sessionId:"conversation"});
    expect(result.memory.projectId).toBe(project.projectId);
    expect(store.getSession(project.projectId,"conversation")?.sessionId).toBe("conversation");
    expect(store.listProjects()).toHaveLength(1);
  } finally { store.close(); rmSync(directory,{recursive:true,force:true}); }
});

// Verifica que los avisos de sesión previa/paralela solo aparecen con inteligencia activada, y que "paralela" pasa a "previa" cuando la otra sesión ya lleva más de PARALLEL_MINUTES sin actividad.
test("a new session reports the project's previous or parallel sessions only once intelligence is enabled", () => {
  const directory = mkdtempSync(join(tmpdir(),"engram-context-previous-"));
  const store = new MemoryStore(":memory:");
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    store.enableSessions();
    const first = startProjectSessionWithNotices(store,directory,"first");
    expect(first).not.toHaveProperty("previous");
    expect(first).not.toHaveProperty("parallel");
    store.enableIntelligence();
    // Se inicia justo después de "first": ambas están abiertas y recientes, así que "second" la reporta como paralela, no como previa.
    const second = startProjectSessionWithNotices(store,directory,"second");
    expect(second).not.toHaveProperty("previous");
    expect(second.parallel).toEqual([{sessionId:"first",lastActivityAt:expect.any(String)}]);
    const replay = startProjectSessionWithNotices(store,directory,"second");
    expect(replay).not.toHaveProperty("previous");
    expect(replay).not.toHaveProperty("parallel");
    // Una vez que la actividad de "first" supera PARALLEL_MINUTES de antigüedad, una sesión nueva la reporta como previa en vez de paralela.
    setSystemTime(new Date("2026-01-01T00:31:00.000Z"));
    const third = startProjectSessionWithNotices(store,directory,"third");
    expect(third.previous).toEqual({sessionId:"first",interruptedAt:expect.any(String),summary:null});
    expect(third).not.toHaveProperty("parallel");
  } finally { setSystemTime(); store.close(); rmSync(directory,{recursive:true,force:true}); }
});
