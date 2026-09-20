import { expect, test } from "bun:test";
import { updateEngram } from "./update";

test("application update delegates to the installed-release updater", async () => {
  let invoked = false;

  await updateEngram({ run: async () => { invoked = true; } });

  expect(invoked).toBe(true);
});
