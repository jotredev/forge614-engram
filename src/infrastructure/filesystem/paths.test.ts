import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultDatabasePath, engramBinDirectory, engramHome, forge614Home, legacyDatabasePath, userStorageDirectory } from "./paths";

function withForge614Home(value: string | undefined, run: () => void): void {
  const previous = process.env.FORGE614_HOME;
  try {
    if (value === undefined) delete process.env.FORGE614_HOME;
    else process.env.FORGE614_HOME = value;
    run();
  } finally {
    if (previous === undefined) delete process.env.FORGE614_HOME;
    else process.env.FORGE614_HOME = previous;
  }
}

test("default paths remain byte-identical without FORGE614_HOME", () => withForge614Home(undefined, () => {
  expect(forge614Home()).toBe(join(homedir(), ".forge614"));
  expect(engramHome()).toBe(join(homedir(), ".forge614", "engram"));
  expect(engramBinDirectory()).toBe(join(homedir(), ".forge614", "engram", "bin"));
  expect(userStorageDirectory()).toBe(join(homedir(), ".forge614", "engram"));
  expect(defaultDatabasePath()).toBe(join(homedir(), ".forge614", "engram", "engram.db"));
  expect(legacyDatabasePath()).toBe(join(homedir(), ".forge614", "engram.db"));
}));

test("absolute FORGE614_HOME is the single root for every derived Engram path", () => withForge614Home("/tmp/forge614-root", () => {
  expect(forge614Home()).toBe("/tmp/forge614-root");
  expect(engramHome()).toBe("/tmp/forge614-root/engram");
  expect(engramBinDirectory()).toBe("/tmp/forge614-root/engram/bin");
  expect(userStorageDirectory()).toBe("/tmp/forge614-root/engram");
  expect(defaultDatabasePath()).toBe("/tmp/forge614-root/engram/engram.db");
  expect(legacyDatabasePath()).toBe("/tmp/forge614-root/engram.db");
}));

test("empty or relative FORGE614_HOME fails closed", () => {
  for (const value of ["", "relative/forge614"]) withForge614Home(value, () => {
    expect(() => forge614Home()).toThrow(expect.objectContaining({ code: "INVALID_FORGE614_HOME" }));
  });
});
