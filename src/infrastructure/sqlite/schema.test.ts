import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { initialize, enableSynchronization, enableAssistantIntegration, enableSessionLifecycle } from "./schema";

test("explicit additive enrollment preserves rows and validates repeated enrollment", () => {
  const db = new Database(":memory:");
  try {
    initialize(db);
    db.exec("INSERT INTO projects VALUES ('p','Kept','now','now')");
    enableSynchronization(db); enableAssistantIntegration(db); enableSessionLifecycle(db); enableSessionLifecycle(db);
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
