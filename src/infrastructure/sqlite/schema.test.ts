import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { initialize, enableSynchronization, enableProjectBindings, enableSessionLifecycle, enableSearchReinforcement } from "./schema";
import { createProject } from "./projects";
import { save } from "./writes";

test("explicit additive enrollment preserves rows and validates repeated enrollment", () => {
  const db = new Database(":memory:");
  try {
    initialize(db);
    db.exec("INSERT INTO projects VALUES ('p','Kept','now','now')");
    enableSynchronization(db); enableProjectBindings(db); enableSessionLifecycle(db); enableSessionLifecycle(db);
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 6 });
    expect(db.query("SELECT name FROM projects").get()).toEqual({ name: "Kept" });
    db.exec("DROP INDEX local_session_directory");
    expect(() => initialize(db)).toThrow(expect.objectContaining({ code: "DATABASE_SCHEMA" }));
  } finally { db.close(); }
});

test("initialization refuses foreign structures without mutating them", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES ('kept')");
    expect(() => initialize(db)).toThrow(expect.objectContaining({ code: "DATABASE_OWNER" }));
    expect(db.query("SELECT * FROM unrelated").all()).toEqual([{ value: "kept" }]);
  } finally { db.close(); }
});

test("reinforcement enrollment upgrades schemas 3 through 6 atomically and preserves history", () => {
  for (const version of [3,4,5,6] as const) {
    const db = new Database(":memory:");
    try {
      initialize(db);
      const project=createProject(db,`Version ${version}`);
      const saved=save(db,{projectId:project.projectId,title:"Kept",content:"History",type:"fact"});
      if(version>=4) enableSynchronization(db);
      if(version>=5) enableProjectBindings(db);
      if(version>=6) enableSessionLifecycle(db);
      const before=db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? AND version=1").get(saved.id);
      enableSearchReinforcement(db); enableSearchReinforcement(db);
      enableSynchronization(db);enableProjectBindings(db);enableSessionLifecycle(db);
      expect(db.query("PRAGMA user_version").get()).toEqual({user_version:7});
      expect(db.query("SELECT snapshot FROM memory_versions WHERE memory_id=? AND version=1").get(saved.id)).toEqual(before);
      expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sync_checkpoints','project_bindings','sessions','confirmations','confirmation_requests') ORDER BY name").all())
        .toEqual([{name:"confirmation_requests"},{name:"confirmations"},{name:"project_bindings"},{name:"sessions"},{name:"sync_checkpoints"}]);
      expect(()=>db.query("INSERT INTO confirmations VALUES ('bad','missing',1,'now',NULL)").run()).toThrow();
      expect(()=>db.query("INSERT INTO confirmation_requests VALUES ('missing','key','hash',NULL,'missing','{}')").run()).toThrow();
    } finally { db.close(); }
  }
});

test("failed reinforcement DDL rolls back prerequisites and version bump", () => {
  const db=new Database(":memory:");
  try {
    initialize(db);enableSynchronization(db);
    const execute=db.exec.bind(db);
    Object.defineProperty(db,"exec",{value:(sql:string)=>execute(sql.includes("CREATE TABLE confirmations")
      ? sql.replace("CREATE INDEX confirmations_memory_time","THIS IS NOT SQL; CREATE INDEX confirmations_memory_time") : sql)});
    expect(()=>enableSearchReinforcement(db)).toThrow();
    expect(db.query("PRAGMA user_version").get()).toEqual({user_version:4});
    expect(db.query("SELECT name FROM sqlite_master WHERE name IN ('project_bindings','sessions','confirmations','confirmation_requests')").all()).toEqual([]);
  } finally {db.close();}
});

test("schema 7 initialization validates exact definitions and future versions remain incompatible", () => {
  const db=new Database(":memory:");
  try {
    initialize(db); enableSearchReinforcement(db); initialize(db);
    db.exec("DROP INDEX confirmations_memory_time");
    expect(()=>initialize(db)).toThrow(expect.objectContaining({code:"DATABASE_SCHEMA"}));
    db.exec("PRAGMA user_version=11");
    expect(()=>initialize(db)).toThrow(expect.objectContaining({code:"DATABASE_VERSION"}));
  } finally { db.close(); }
});
