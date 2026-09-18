import { expect, test } from "bun:test";
import { withDatabase } from "../__test-support__/fixtures";
import { createProject } from "./projects";
import { enableAssistantIntegration, enableSearchReinforcement, enableSessionLifecycle, enableSynchronization } from "./schema";
import { archive, bindProjectDirectory, save } from "./writes";
import { readControlCenter } from "./control-center";

test("control-center summaries isolate owners and expose only aggregate metadata", () => withDatabase(db => {
  const beta = createProject(db, "Beta");
  const alpha = createProject(db, "Alpha");
  enableAssistantIntegration(db);
  bindProjectDirectory(db, "/tmp/beta-b", beta.projectId);
  bindProjectDirectory(db, "/tmp/beta-a", beta.projectId);

  const active = save(db, { projectId:beta.projectId, title:"B", content:"private beta", type:"fact" });
  const archived = save(db, { projectId:beta.projectId, title:"Old", content:"archived body", type:"fact" });
  archive(db, beta.projectId, archived.id);
  const shared = save(db, { scope:"shared", projectId:null, title:"S", content:"global body", type:"fact" });
  db.query("UPDATE memories SET updated_at=? WHERE id=?").run("2026-01-02T00:00:00.000Z", active.id);
  db.query("UPDATE memories SET updated_at=? WHERE id=?").run("2026-01-03T00:00:00.000Z", archived.id);
  db.query("UPDATE memories SET updated_at=? WHERE id=?").run("2026-01-04T00:00:00.000Z", shared.id);

  const before = (db.query("SELECT total_changes() AS count").get() as {count:number}).count;
  const snapshot = readControlCenter(db);
  const after = (db.query("SELECT total_changes() AS count").get() as {count:number}).count;

  expect(snapshot).toEqual({
    capabilities: { schema:5, assistantIntegration:true, sessions:false, reinforcement:false },
    projects: [
      { ...alpha, bindings:[], memories:{active:0, archived:0, lastUpdatedAt:null} },
      { ...beta, bindings:["/tmp/beta-a", "/tmp/beta-b"], memories:{active:1, archived:1, lastUpdatedAt:"2026-01-03T00:00:00.000Z"} },
    ],
    shared: { active:1, archived:0, lastUpdatedAt:"2026-01-04T00:00:00.000Z" },
  });
  expect(after).toBe(before);
  expect(JSON.stringify(snapshot)).not.toContain("private beta");
  expect(JSON.stringify(snapshot)).not.toContain("archived body");
  expect(JSON.stringify(snapshot)).not.toContain("global body");
  expect(JSON.stringify(snapshot)).not.toContain('"content"');
  expect(JSON.stringify(snapshot)).not.toContain('"snapshot"');
}));

test("control-center capabilities recognize only supported schemas", () => withDatabase(db => {
  expect(readControlCenter(db).capabilities).toEqual({schema:3, assistantIntegration:false, sessions:false, reinforcement:false});
  enableSynchronization(db);
  expect(readControlCenter(db).capabilities).toEqual({schema:4, assistantIntegration:false, sessions:false, reinforcement:false});
  enableAssistantIntegration(db);
  expect(readControlCenter(db).capabilities).toEqual({schema:5, assistantIntegration:true, sessions:false, reinforcement:false});
  enableSessionLifecycle(db);
  expect(readControlCenter(db).capabilities).toEqual({schema:6, assistantIntegration:true, sessions:true, reinforcement:false});
  enableSearchReinforcement(db);
  expect(readControlCenter(db).capabilities).toEqual({schema:7, assistantIntegration:true, sessions:true, reinforcement:true});
  db.exec("PRAGMA user_version=8");
  expect(() => readControlCenter(db)).toThrow(expect.objectContaining({code:"DATABASE_VERSION"}));
}));
