import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNodeEcosystem } from "./node-file";

const roots: string[] = [];
function repository(content?: string): string {
  const root = mkdtempSync(join(tmpdir(), "engram-node-")); roots.push(root);
  if (content !== undefined) writeFileSync(join(root, "forge614.node.json"), content);
  return root;
}
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

test("a node file that declares an ecosystem yields its name", () => {
  expect(readNodeEcosystem(repository(JSON.stringify({ schemaVersion: 1, node: "engram", kind: "product", ecosystem: "forge614" })))).toBe("forge614");
});

test("no file, no declaration or anything unusable means no group; nothing is inferred", () => {
  expect(readNodeEcosystem(repository())).toBeNull();
  expect(readNodeEcosystem(repository(JSON.stringify({ schemaVersion: 1, node: "engram" })))).toBeNull();
  for (const content of ["{", "[]", "\"x\"", JSON.stringify({ ecosystem: 7 }), JSON.stringify({ ecosystem: "Mal Nombre" }), JSON.stringify({ ecosystem: "" }), " ".repeat(70_000)]) {
    expect(readNodeEcosystem(repository(content))).toBeNull();
  }
  const linked = repository(); const target = join(repository(JSON.stringify({ ecosystem: "forge614" })), "forge614.node.json");
  symlinkSync(target, join(linked, "forge614.node.json"));
  expect(readNodeEcosystem(linked)).toBeNull();
});
