/** Loopback-only smoke checks for the release installer entry points. */

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const root = resolve(import.meta.dir, "../..");

test("rendered Node installer and POSIX gatekeeper help run without creating Forge614 storage", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "forge614-engram-installer-help-"));
  const home = join(temporary, "home");
  const forgeHome = join(temporary, "forge614");
  mkdirSync(home);
  mkdirSync(forgeHome);
  const files = new Map<string, Uint8Array>();
  for (const name of ["install.mjs", "forge614.node.json"]) files.set(name, await readFile(join(root, name)));
  const sums = [...files].map(([name, bytes]) => `${createHash("sha256").update(bytes).digest("hex")}  ${name}`).join("\n") + "\n";
  const serverSource = `const files={"install.mjs":Buffer.from(process.env.INSTALL_MJS_B64,"base64"),"forge614.node.json":Buffer.from(process.env.POINTER_B64,"base64"),"SHA256SUMS":Buffer.from(process.env.SUMS_B64,"base64")};const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){const name=new URL(request.url).pathname.split("/").at(-1)||"";const bytes=files[name];return bytes?new Response(bytes):new Response("not found",{status:404})}});console.log(server.port);`;
  const serverChild = Bun.spawn([process.execPath, "-e", serverSource], {
    stdout: "pipe", stderr: "pipe",
    env: {
      ...process.env,
      INSTALL_MJS_B64: Buffer.from(files.get("install.mjs")!).toString("base64"),
      POINTER_B64: Buffer.from(files.get("forge614.node.json")!).toString("base64"),
      SUMS_B64: Buffer.from(sums).toString("base64"),
    },
  });
  const reader = serverChild.stdout.getReader();
  const firstLine = await reader.read();
  const port = Number(new TextDecoder().decode(firstLine.value).trim());
  const env = { ...process.env, HOME: home, USERPROFILE: home, FORGE614_HOME: forgeHome, FORGE614_INSTALL_TEST_BASE_URL: `http://127.0.0.1:${port}` };
  try {
    for (const command of [
      ["node", join(root, "install.mjs"), "--help"],
      ["bash", join(root, "install.sh"), "--version", "v1.10.0", "--help"],
    ]) {
      const result = Bun.spawnSync(command, { cwd: root, env });
      const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
      expect(result.exitCode, output).toBe(0);
      expect(result.stdout.toString()).toContain("--uninstall");
    }
    expect(readdirSync(forgeHome)).toEqual([]);
    expect(existsSync(join(home, ".forge614"))).toBe(false);
  } finally { serverChild.kill(); await serverChild.exited; rmSync(temporary, { recursive: true, force: true }); }
});
