import { mock } from "bun:test";
import * as os from "node:os";

// Child-process-only seam: never change HOME or write test data in the real home.
const directory = process.env.FORGE614_TEST_USER_DIRECTORY;
if (!directory) throw new Error("Missing isolated test user directory");
mock.module("node:os", () => ({ ...os, homedir: () => directory }));
