import { expect, test } from "bun:test";
import { sessionIdentity, sessionNotice, summaryContent } from "./rules";
import type { ParallelSession, PreviousSession } from "./types";

test("session IDs count Unicode characters and reject blank, control and exterior whitespace", () => {
  const boundary = "😀".repeat(200);
  expect(sessionIdentity(boundary)).toBe(boundary);
  for (const value of [boundary + "a", "", " bad", "bad ", "a\n", "a\u200b", null]) {
    expect(() => sessionIdentity(value)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  }
});

const fields = {goal:"g",instructions:"i",discoveries:"d",accomplishments:"a",nextSteps:"n",files:["x","y"]};
test("summary rendering preserves structured field ordering and file lines", () => {
  expect(summaryContent(fields)).toBe("Goal:\ng\n\nInstructions:\ni\n\nDiscoveries:\nd\n\nAccomplishments:\na\n\nNext steps:\nn\n\nFiles:\nx\ny");
});
test("summary validation rejects a blank goal, NUL text and nontext files", () => {
  for (const value of [{...fields,goal:" "},{...fields,instructions:"bad\0"},{...fields,files:[42]}]) {
    expect(() => summaryContent(value as typeof fields)).toThrow(expect.objectContaining({code:"INVALID_INPUT"}));
  }
});

const previousWithSummary:PreviousSession = {sessionId:"first",interruptedAt:"2026-01-01T00:00:00.000Z",summary:{id:"m1",version:1} as PreviousSession["summary"]};
const previousNoSummary:PreviousSession = {sessionId:"first",interruptedAt:"2026-01-01T00:00:00.000Z",summary:null};
const oneParallel:ParallelSession[] = [{sessionId:"second",lastActivityAt:"2026-01-01T00:10:00.000Z"}];
const manyParallel:ParallelSession[] = [{sessionId:"second",lastActivityAt:"2026-01-01T00:10:00.000Z"},{sessionId:"third",lastActivityAt:"2026-01-01T00:11:00.000Z"}];

test("sessionNotice states the previous session left open, whether or not it saved a summary", () => {
  expect(sessionNotice(previousWithSummary,null)).toBe("Session first was left open; its last activity was at 2026-01-01T00:00:00.000Z; its summary is available.");
  expect(sessionNotice(previousNoSummary,null)).toBe("Session first was left open; its last activity was at 2026-01-01T00:00:00.000Z; it saved no summary.");
});
test("sessionNotice states which sessions are open now, singular and plural", () => {
  expect(sessionNotice(null,oneParallel)).toBe("Another session is open now: second.");
  expect(sessionNotice(null,manyParallel)).toBe("Other sessions are open now: second, third.");
});
test("sessionNotice joins the previous sentence and the parallel sentence, previous first", () => {
  expect(sessionNotice(previousWithSummary,oneParallel)).toBe("Session first was left open; its last activity was at 2026-01-01T00:00:00.000Z; its summary is available. Another session is open now: second.");
});
test("sessionNotice is null with neither previous nor parallel", () => {
  expect(sessionNotice(null,null)).toBeNull();
  expect(sessionNotice(undefined,undefined)).toBeNull();
  expect(sessionNotice(null,[])).toBeNull();
});
