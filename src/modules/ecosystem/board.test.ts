import { expect, test } from "bun:test";
import { boardTypeAllowed, ECOSYSTEM_AFFECTS_MIN, ECOSYSTEM_BOARD_LIMIT, ECOSYSTEM_STATUS_MAX, ECOSYSTEM_STATUS_TOPIC } from "./board";

test("board constants and allowed types; only the status note also accepts facts", () => {
  expect([ECOSYSTEM_BOARD_LIMIT, ECOSYSTEM_AFFECTS_MIN, ECOSYSTEM_STATUS_MAX, ECOSYSTEM_STATUS_TOPIC]).toEqual([40, 2, 600, "ecosystem/estado-actual"]);
  const types = ["decision", "procedure", "warning", "fact", "preference"];
  expect(types.map(type => boardTypeAllowed(type, "api"))).toEqual([true, true, true, false, false]);
  expect(types.map(type => boardTypeAllowed(type, null))).toEqual([true, true, true, false, false]);
  expect(types.map(type => boardTypeAllowed(type, ECOSYSTEM_STATUS_TOPIC))).toEqual([true, true, true, true, false]);
});
