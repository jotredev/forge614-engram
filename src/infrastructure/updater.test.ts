import { expect, test } from "bun:test";
import { updateInstalledEngram } from "./updater";

test("update downloads the stable installer and explicitly replaces only the installed command", async () => {
  const calls: string[] = [];
  let cleaned = false;

  await updateInstalledEngram({
    download: async (url) => {
      calls.push(`download ${url}`);
      return { installer: "/tmp/forge614-engram-install.sh", cleanup: () => { cleaned = true; } };
    },
    spawn: (command, args) => {
      calls.push(`${command} ${args.join(" ")}`);
      return { status: 0 };
    },
  });

  expect(calls).toEqual([
    "download https://github.com/jotredev/forge614-engram/releases/latest/download/install.sh",
    "bash /tmp/forge614-engram-install.sh --force",
  ]);
  expect(cleaned).toBe(true);
});

test("update preserves the installed command when the verified installer fails", async () => {
  let cleaned = false;

  await expect(updateInstalledEngram({
    download: async () => ({ installer: "/tmp/forge614-engram-install.sh", cleanup: () => { cleaned = true; } }),
    spawn: () => ({ status: 1, stderr: "download failed" }),
  })).rejects.toThrow("download failed");

  expect(cleaned).toBe(true);
});
