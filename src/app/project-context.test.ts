import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./memory-store";
import { bindProjectContext, resolveProjectContext, saveProjectMemoryWithSession, startProjectSession } from "./project-context";

test("context rejects a nonboolean create flag before directory discovery", () => {
  const store = new MemoryStore(":memory:");
  try {
    expect(() => resolveProjectContext(store,"/missing",1 as unknown as boolean)).toThrow(expect.objectContaining({code:"INVALID_INPUT"}));
    expect(store.listProjects()).toEqual([]);
  } finally { store.close(); }
});
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
