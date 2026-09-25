import { expect, setSystemTime, test } from "bun:test";
import { withDatabase } from "../__test-support__/fixtures";
import { createProject } from "./projects";
import { readMeta } from "./meta";
import { enableIntelligence, enableSearchReinforcement } from "./schema";
import { getVersion, searchPreviews } from "./search";
import { save } from "./writes";

const secretText = ["pass", "word = ", "hunter2hunter2"].join("");

test("secrets are rejected at every schema level, naming the kind and never the value", () => {
  for (const level of ["base", "intelligence"] as const) withDatabase(db => {
    if (level === "intelligence") enableIntelligence(db);
    const project = createProject(db, "Secrets");
    let error: unknown;
    try { save(db, { projectId: project.projectId, type: "fact", title: "Credenciales", content: secretText }); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: "SECRET_REJECTED" });
    expect(String((error as Error).message)).not.toContain("hunter2");
    expect(db.query("SELECT count(*) AS n FROM memories").get()).toEqual({ n: 0 });
  });
});

test("secrets in short or affects are rejected too, and nothing is stored", () => withDatabase(db => {
  enableIntelligence(db);
  const project = createProject(db, "Secrets");
  for (const extra of [{ short: secretText }, { affects: ["forge614-engram", secretText] }]) {
    let error: unknown;
    try { save(db, { projectId: project.projectId, type: "decision", title: "Regla", content: "c", ...extra }); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: "SECRET_REJECTED" });
    expect(String((error as Error).message)).not.toContain("hunter2");
  }
  expect(db.query("SELECT count(*) AS n FROM memories").get()).toEqual({ n: 0 });
  expect(db.query("SELECT count(*) AS n FROM memory_meta").get()).toEqual({ n: 0 });
}));

test("metadata fields below level 11 are rejected, never dropped", () => withDatabase(db => {
  enableSearchReinforcement(db);
  const project = createProject(db, "Old");
  expect(() => save(db, { projectId: project.projectId, type: "fact", title: "T", content: "c", short: "corta" }))
    .toThrow(expect.objectContaining({ code: "INTELLIGENCE_REQUIRED" }));
}));

test("decisions get a review date; short survives same content, is cleared on new content, and can be added by confirmation", () => withDatabase(db => {
  enableIntelligence(db);
  setSystemTime(new Date("2026-09-24T12:00:00.000Z"));
  try {
    const project = createProject(db, "Meta");
    const v1 = save(db, { projectId: project.projectId, type: "decision", title: "D", content: "uno", topicKey: "d", short: "corta" });
    expect(readMeta(db, v1.id)).toMatchObject({ short: "corta", reviewAfter: "2026-12-23T12:00:00.000Z" });
    save(db, { projectId: project.projectId, type: "decision", title: "D", content: "dos", topicKey: "d", expectedVersion: 1 });
    expect(readMeta(db, v1.id)?.short).toBeNull();
    save(db, { projectId: project.projectId, type: "decision", title: "D", content: "dos", topicKey: "d", expectedVersion: 2, short: "nueva corta" });
    expect(readMeta(db, v1.id)?.short).toBe("nueva corta");
    expect(db.query("SELECT max(version) AS v FROM memory_versions WHERE memory_id=?").get(v1.id)).toEqual({ v: 2 });
  } finally { setSystemTime(); }
}));

test("supersedes marks the replaced memory in the same scope and owner only", () => withDatabase(db => {
  enableIntelligence(db);
  const project = createProject(db, "Meta"), other = createProject(db, "Other");
  const old = save(db, { projectId: project.projectId, type: "decision", title: "Vieja", content: "usar A" });
  const foreign = save(db, { projectId: other.projectId, type: "decision", title: "Ajena", content: "usar Z" });
  const fresh = save(db, { projectId: project.projectId, type: "decision", title: "Nueva", content: "usar B", supersedes: old.id });
  expect(readMeta(db, old.id)?.supersededBy).toBe(fresh.id);
  expect(() => save(db, { projectId: project.projectId, type: "fact", title: "X", content: "x", supersedes: foreign.id }))
    .toThrow(expect.objectContaining({ code: "SUPERSEDES_NOT_FOUND" }));
  expect(() => save(db, { projectId: project.projectId, type: "fact", title: "X", content: "x", supersedes: "missing" }))
    .toThrow(expect.objectContaining({ code: "SUPERSEDES_NOT_FOUND" }));
  const topic = save(db, { projectId: project.projectId, type: "fact", title: "T", content: "t", topicKey: "t" });
  expect(() => save(db, { projectId: project.projectId, type: "fact", title: "T", content: "t2", topicKey: "t", expectedVersion: 1, supersedes: topic.id }))
    .toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
}));

test("get and search expose meta and marks at level 11 only, including verify after the review date", () => {
  withDatabase(db => {
    enableIntelligence(db);
    const project = createProject(db, "Meta");
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const saved = save(db, { projectId: project.projectId, type: "decision", title: "Regla del almacenamiento", content: "usar SQLite", affects: ["shell", "engram"] });
    setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    try {
      expect(getVersion(db, project.projectId, saved.id)).toMatchObject({ meta: { affects: ["engram", "shell"] }, marks: ["verify"] });
      expect(searchPreviews(db, project.projectId, "almacenamiento")[0]).toMatchObject({ marks: ["verify"] });
    } finally { setSystemTime(); }
  });
  withDatabase(db => {
    enableSearchReinforcement(db);
    const project = createProject(db, "Old");
    const saved = save(db, { projectId: project.projectId, type: "decision", title: "Regla vieja", content: "usar SQLite" });
    const read = getVersion(db, project.projectId, saved.id)!;
    expect(Object.keys(read).sort()).toEqual(["currentVersion", "memory", "state"]);
    expect(Object.keys(searchPreviews(db, project.projectId, "vieja")[0]!).sort()).toEqual(["explanation", "memory"]);
  });
});
