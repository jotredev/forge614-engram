import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultDatabasePath, engramBinDirectory, engramHome, forge614Home, legacyDatabasePath, userStorageDirectory } from "./paths";

test("default paths live inside the Engram product home", () => {
  expect(forge614Home()).toBe(join(homedir(), ".forge614"));
  expect(engramHome()).toBe(join(homedir(), ".forge614", "engram"));
  expect(engramBinDirectory()).toBe(join(homedir(), ".forge614", "engram", "bin"));
  expect(userStorageDirectory()).toBe(join(homedir(), ".forge614", "engram"));
  expect(defaultDatabasePath()).toBe(join(homedir(), ".forge614", "engram", "engram.db"));
  expect(legacyDatabasePath()).toBe(join(homedir(), ".forge614", "engram.db"));
});
