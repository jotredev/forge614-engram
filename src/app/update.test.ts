import { expect, test } from "bun:test";
import { updateEngram } from "./update";

test("application update delegates to the installed-release updater", async () => {
  let invoked = false;

  await updateEngram("1.3.0", { run: async () => { invoked = true; return { updated: false, previousVersion: "1.3.0", installedVersion: "1.3.0" }; } });

  expect(invoked).toBe(true);
});

test("application update returns structured versions for CLI consumers", async () => {
  const result = await updateEngram("1.3.0", {
    run: async () => ({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" }),
  });

  expect(result).toEqual({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" });
});

test("application update masks installer diagnostics behind UPDATE_FAILED", async () => {
  const secret = "POSTGRES_PASSWORD_SHOULD_NOT_LEAK";

  await expect(updateEngram("1.3.0", { run: async () => { throw new Error(secret); } })).rejects.toMatchObject({
    code: "UPDATE_FAILED",
    message: "No se pudo actualizar Forge614 Engram.",
  });

  await expect(updateEngram("1.3.0", { run: async () => { throw new Error(secret); } })).rejects.not.toThrow(secret);
});
