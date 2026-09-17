import { expect, test } from "bun:test";
import { sessionIdentity, summaryContent } from "./rules";

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
