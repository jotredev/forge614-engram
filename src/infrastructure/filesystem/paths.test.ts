import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultDatabasePath, userStorageDirectory } from "./paths";

test("default database and workspace share the user storage root", () => {
  expect(userStorageDirectory()).toBe(join(homedir(), ".forge614"));
  expect(defaultDatabasePath()).toBe(join(homedir(), ".forge614", "engram.db"));
});
