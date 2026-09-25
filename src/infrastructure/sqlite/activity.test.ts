import { expect, setSystemTime, test } from "bun:test";
import { withDatabase } from "../__test-support__/fixtures";
import { createProject } from "./projects";
import { inferredSessions, manualSession } from "./sessions";
import { enableIntelligence, enableSearchReinforcement } from "./schema";
import { endSession, saveSessionSummary, saveWithSession, startSession } from "./writes";
import { parallelSessions, previousInterrupted, touchSession } from "./activity";

test("below intelligence level, touchSession is inert, previousInterrupted/parallelSessions are empty and inference keeps the seven-day window", () => withDatabase(db => {
  enableSearchReinforcement(db);
  const p = createProject(db, "Pre11");
  startSession(db, p.projectId, "old", "/dir");
  expect(() => touchSession(db, "old", new Date().toISOString())).not.toThrow();
  expect(previousInterrupted(db, p.projectId)).toBeNull();
  expect(parallelSessions(db, p.projectId, "old")).toEqual([]);
  db.query("UPDATE sessions SET startedAt=? WHERE sessionId='old'").run(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString());
  expect(inferredSessions(db, p.projectId, "/dir", new Date().toISOString())).toEqual(["old"]);
}));

test("starting a new runtime session marks nobody: other open sessions keep interruptedAt untouched", () => withDatabase(db => {
  enableIntelligence(db);
  const p = createProject(db, "P");
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    startSession(db, p.projectId, "A", "/a");
    setSystemTime(new Date("2026-01-01T00:10:00.000Z"));
    startSession(db, p.projectId, "B", "/b");
    expect(db.query("SELECT sessionId,interruptedAt FROM session_activity ORDER BY sessionId").all())
      .toEqual([{ sessionId: "A", interruptedAt: null }, { sessionId: "B", interruptedAt: null }]);
    // Both sessions are recent: nobody counts as left open yet, and A is open in parallel with B.
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:10:00.000Z")).toBeNull();
    expect(parallelSessions(db, p.projectId, "B", "2026-01-01T00:10:00.000Z"))
      .toEqual([{ sessionId: "A", lastActivityAt: "2026-01-01T00:00:00.000Z" }]);
    startSession(db, p.projectId, "B", "/b"); // replay: marks nobody either
    expect(db.query("SELECT interruptedAt FROM session_activity WHERE sessionId='A'").get()).toEqual({ interruptedAt: null });
  } finally { setSystemTime(); }
}));

test("a session left open crosses from parallel to previous exactly at PARALLEL_MINUTES", () => withDatabase(db => {
  enableIntelligence(db);
  const p = createProject(db, "P");
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    startSession(db, p.projectId, "A", "/a");
    startSession(db, p.projectId, "B", "/b");
    expect(parallelSessions(db, p.projectId, "B", "2026-01-01T00:29:59.000Z"))
      .toEqual([{ sessionId: "A", lastActivityAt: "2026-01-01T00:00:00.000Z" }]);
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:29:59.000Z")).toBeNull();
    // At exactly the 30-minute boundary A is still parallel (>= threshold), not yet previous.
    expect(parallelSessions(db, p.projectId, "B", "2026-01-01T00:30:00.000Z"))
      .toEqual([{ sessionId: "A", lastActivityAt: "2026-01-01T00:00:00.000Z" }]);
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:30:00.000Z")).toBeNull();
    // One second later, A crosses to previous (its last activity is now strictly before the threshold)
    // and drops out of parallel.
    expect(parallelSessions(db, p.projectId, "B", "2026-01-01T00:30:01.000Z")).toEqual([]);
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:30:01.000Z"))
      .toEqual({ sessionId: "A", interruptedAt: "2026-01-01T00:00:00.000Z", summary: null });
  } finally { setSystemTime(); }
}));

test("a legacy interruptedAt mark is ignored entirely: a session active 5 minutes ago is parallel, not previous", () => withDatabase(db => {
  enableIntelligence(db);
  const p = createProject(db, "P");
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    startSession(db, p.projectId, "A", "/a");
    setSystemTime(new Date("2026-01-01T00:05:00.000Z"));
    // Simulate data left over from a pre-1.7.1 database: an old interruptedAt mark alongside
    // genuine recent activity. Classification is by elapsed time alone, so the mark is ignored.
    db.query("UPDATE session_activity SET lastActivityAt=?,interruptedAt=? WHERE sessionId='A'")
      .run("2026-01-01T00:05:00.000Z", "2026-01-01T00:00:00.000Z");
    startSession(db, p.projectId, "B", "/b");
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:05:00.000Z")).toBeNull();
    expect(parallelSessions(db, p.projectId, "B", "2026-01-01T00:05:00.000Z"))
      .toEqual([{ sessionId: "A", lastActivityAt: "2026-01-01T00:05:00.000Z" }]);
  } finally { setSystemTime(); }
}));

test("parallelSessions caps at 3, newest first, and excludes ended, manual, other-project and self sessions", () => withDatabase(db => {
  enableIntelligence(db);
  const p = createProject(db, "P"), other = createProject(db, "Other");
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    startSession(db, p.projectId, "Z", "/z");
    endSession(db, p.projectId, "Z");
    manualSession(db, p.projectId, new Date().toISOString());
    startSession(db, other.projectId, "O", "/o");
    startSession(db, p.projectId, "A", "/a");
    setSystemTime(new Date("2026-01-01T00:01:00.000Z"));
    startSession(db, p.projectId, "B", "/b");
    setSystemTime(new Date("2026-01-01T00:02:00.000Z"));
    startSession(db, p.projectId, "C", "/c");
    setSystemTime(new Date("2026-01-01T00:03:00.000Z"));
    startSession(db, p.projectId, "D", "/d");
    expect(parallelSessions(db, p.projectId, "D", "2026-01-01T00:03:00.000Z")).toEqual([
      { sessionId: "C", lastActivityAt: "2026-01-01T00:02:00.000Z" },
      { sessionId: "B", lastActivityAt: "2026-01-01T00:01:00.000Z" },
      { sessionId: "A", lastActivityAt: "2026-01-01T00:00:00.000Z" },
    ]);
  } finally { setSystemTime(); }
}));

test("a session left open past PARALLEL_MINUTES is reported by previousInterrupted, and any activity postpones it", () => withDatabase(db => {
  enableIntelligence(db);
  const p = createProject(db, "P");
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    startSession(db, p.projectId, "S", "/s");
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:29:00.000Z")).toBeNull();
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:30:01.000Z"))
      .toEqual({ sessionId: "S", interruptedAt: "2026-01-01T00:00:00.000Z", summary: null });
    setSystemTime(new Date("2026-01-01T00:10:00.000Z"));
    saveWithSession(db, { projectId: p.projectId, title: "Note", content: "Body", type: "fact" }, { sessionId: "S" });
    // S's last activity just moved to 00:10, so it is not left open again until past 00:40.
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:30:01.000Z")).toBeNull();
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:40:01.000Z"))
      .toEqual({ sessionId: "S", interruptedAt: "2026-01-01T00:10:00.000Z", summary: null });
    setSystemTime(new Date("2026-01-01T00:41:00.000Z"));
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
    // Nobody is marked at session start any more (1.7.1); simulate a legacy mark left by a
    // pre-1.7.1 database directly, to show inference still excludes an explicitly marked session.
    db.query("UPDATE session_activity SET interruptedAt=? WHERE sessionId='old'").run(new Date().toISOString());
    expect(inferredSessions(db, marked.projectId, "/dir", "2026-01-01T01:00:00.000Z")).toEqual(["new"]);
    startSession(db, idle.projectId, "fresh", "/dir");
    expect(inferredSessions(db, idle.projectId, "/dir", "2026-01-01T06:59:00.000Z")).toEqual(["fresh"]);
    expect(inferredSessions(db, idle.projectId, "/dir", "2026-01-01T07:01:00.000Z")).toEqual([]);
    manualSession(db, marked.projectId, new Date().toISOString());
    expect(db.query("SELECT count(*) AS n FROM session_activity").get()).toEqual({ n: 3 });
  } finally { setSystemTime(); }
}));

test("previousInterrupted returns the last summary of the session left open", () => withDatabase(db => {
  enableIntelligence(db);
  const p = createProject(db, "P");
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    startSession(db, p.projectId, "A", "/a");
    const summary = saveSessionSummary(db, p.projectId, "A",
      { goal: "g", instructions: "", discoveries: "", accomplishments: "", nextSteps: "", files: [] }, { requestKey: "r" });
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:30:01.000Z"))
      .toEqual({ sessionId: "A", interruptedAt: "2026-01-01T00:00:00.000Z", summary: summary.memory });
  } finally { setSystemTime(); }
}));
