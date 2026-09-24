import { expect, setSystemTime, test } from "bun:test";
import { withDatabase } from "../__test-support__/fixtures";
import { createProject } from "./projects";
import { inferredSessions, manualSession } from "./sessions";
import { enableIntelligence, enableSearchReinforcement } from "./schema";
import { endSession, saveSessionSummary, saveWithSession, startSession } from "./writes";
import { previousInterrupted, touchSession } from "./activity";

test("below intelligence level, touchSession is inert, previousInterrupted is null and inference keeps the seven-day window", () => withDatabase(db => {
  enableSearchReinforcement(db);
  const p = createProject(db, "Pre11");
  startSession(db, p.projectId, "old", "/dir");
  expect(() => touchSession(db, "old", new Date().toISOString())).not.toThrow();
  expect(previousInterrupted(db, p.projectId)).toBeNull();
  db.query("UPDATE sessions SET startedAt=? WHERE sessionId='old'").run(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString());
  expect(inferredSessions(db, p.projectId, "/dir", new Date().toISOString())).toEqual(["old"]);
}));

test("starting a new runtime session marks every other open runtime session of the project, never itself", () => withDatabase(db => {
  enableIntelligence(db);
  const p = createProject(db, "P"), other = createProject(db, "Other");
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    // An already-ended session and another project's session are set up first so their own starts
    // (which would otherwise mark A and B too) happen before A and B even exist.
    startSession(db, p.projectId, "E");
    endSession(db, p.projectId, "E");
    startSession(db, other.projectId, "X", "/x");
    const manualId = manualSession(db, p.projectId, new Date().toISOString());
    startSession(db, p.projectId, "A", "/a");
    startSession(db, p.projectId, "B", "/b"); // marks A; the summary save below clears that mark again
    const summary = saveSessionSummary(db, p.projectId, "A",
      { goal: "g", instructions: "", discoveries: "", accomplishments: "", nextSteps: "", files: [] }, { requestKey: "r" });
    setSystemTime(new Date("2026-01-01T01:00:00.000Z"));
    startSession(db, p.projectId, "C", "/c");
    const cStart = "2026-01-01T01:00:00.000Z";
    expect(db.query("SELECT sessionId,interruptedAt FROM session_activity WHERE sessionId IN ('A','B') ORDER BY sessionId").all())
      .toEqual([{ sessionId: "A", interruptedAt: cStart }, { sessionId: "B", interruptedAt: cStart }]);
    expect(db.query("SELECT sessionId,interruptedAt FROM session_activity WHERE sessionId IN ('C','E','X') ORDER BY sessionId").all())
      .toEqual([{ sessionId: "C", interruptedAt: null }, { sessionId: "E", interruptedAt: null }, { sessionId: "X", interruptedAt: null }]);
    expect(db.query("SELECT count(*) AS n FROM session_activity WHERE sessionId=?").get(manualId)).toEqual({ n: 0 });
    expect(previousInterrupted(db, p.projectId)).toEqual({ sessionId: "A", interruptedAt: cStart, summary: summary.memory });
    startSession(db, p.projectId, "C", "/c"); // replay: marks nobody
    expect(db.query("SELECT sessionId,interruptedAt FROM session_activity WHERE sessionId IN ('A','B') ORDER BY sessionId").all())
      .toEqual([{ sessionId: "A", interruptedAt: cStart }, { sessionId: "B", interruptedAt: cStart }]);
    setSystemTime(new Date("2026-01-01T02:00:00.000Z"));
    startSession(db, p.projectId, "D", "/d");
    expect(db.query("SELECT interruptedAt FROM session_activity WHERE sessionId='A'").get()).toEqual({ interruptedAt: cStart });
  } finally { setSystemTime(); }
}));

test("a session idle past the inactivity window is reported and any activity clears the mark", () => withDatabase(db => {
  enableIntelligence(db);
  const p = createProject(db, "P");
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    startSession(db, p.projectId, "S", "/s");
    expect(previousInterrupted(db, p.projectId, "2026-01-01T05:00:00.000Z")).toBeNull();
    expect(previousInterrupted(db, p.projectId, "2026-01-01T06:01:00.000Z"))
      .toEqual({ sessionId: "S", interruptedAt: "2026-01-01T06:00:00.000Z", summary: null });
    setSystemTime(new Date("2026-01-01T05:00:00.000Z"));
    saveWithSession(db, { projectId: p.projectId, title: "Note", content: "Body", type: "fact" }, { sessionId: "S" });
    expect(previousInterrupted(db, p.projectId, "2026-01-01T06:01:00.000Z")).toBeNull();
    setSystemTime(new Date("2026-01-01T05:30:00.000Z"));
    startSession(db, p.projectId, "other", "/o");
    expect(db.query("SELECT interruptedAt FROM session_activity WHERE sessionId='S'").get())
      .toEqual({ interruptedAt: "2026-01-01T05:30:00.000Z" });
    setSystemTime(new Date("2026-01-01T05:45:00.000Z"));
    saveWithSession(db, { projectId: p.projectId, title: "Note2", content: "Body2", type: "fact" }, { sessionId: "S" });
    expect(db.query("SELECT interruptedAt FROM session_activity WHERE sessionId='S'").get()).toEqual({ interruptedAt: null });
    setSystemTime(new Date("2026-01-01T06:00:00.000Z"));
    startSession(db, p.projectId, "other2", "/o2");
    expect(db.query("SELECT interruptedAt FROM session_activity WHERE sessionId='S'").get())
      .toEqual({ interruptedAt: "2026-01-01T06:00:00.000Z" });
    const ended = endSession(db, p.projectId, "S");
    expect(ended.endedAt).not.toBeNull();
    expect(db.query("SELECT interruptedAt FROM session_activity WHERE sessionId='S'").get()).toEqual({ interruptedAt: null });
    expect(previousInterrupted(db, p.projectId, "2026-06-01T00:00:00.000Z")?.sessionId).not.toBe("S");
  } finally { setSystemTime(); }
}));

test("inference at level 11 excludes marked and stale sessions; manual sessions stay untouched", () => withDatabase(db => {
  enableIntelligence(db);
  const marked = createProject(db, "Marked"), idle = createProject(db, "Idle");
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    startSession(db, marked.projectId, "old", "/dir");
    setSystemTime(new Date("2026-01-01T01:00:00.000Z"));
    startSession(db, marked.projectId, "new", "/dir");
    expect(inferredSessions(db, marked.projectId, "/dir", "2026-01-01T01:00:00.000Z")).toEqual(["new"]);
    startSession(db, idle.projectId, "fresh", "/dir");
    expect(inferredSessions(db, idle.projectId, "/dir", "2026-01-01T06:59:00.000Z")).toEqual(["fresh"]);
    expect(inferredSessions(db, idle.projectId, "/dir", "2026-01-01T07:01:00.000Z")).toEqual([]);
    manualSession(db, marked.projectId, new Date().toISOString());
    expect(db.query("SELECT count(*) AS n FROM session_activity").get()).toEqual({ n: 3 });
  } finally { setSystemTime(); }
}));
