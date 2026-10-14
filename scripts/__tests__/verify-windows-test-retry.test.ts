import { expect, test } from "bun:test";
import { shouldRetryBunCrash } from "../verify-windows-test-retry.mjs";

test("retries a Bun crash with exit code 3", () => {
  expect(shouldRetryBunCrash(3, "panic(main thread): Segmentation fault\nBun has crashed")).toBe(true);
});

test("does not retry a normal failing test", () => {
  expect(shouldRetryBunCrash(1, "(fail) expected result")).toBe(false);
});

test("does not retry a second Bun crash", () => {
  expect(shouldRetryBunCrash(3, "Bun has crashed", true)).toBe(false);
});

test("does not retry a successful test", () => {
  expect(shouldRetryBunCrash(0, "12 pass")).toBe(false);
});
