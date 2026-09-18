import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectAssistants } from "./assistants";

test("assistant detection previews absent clients without writing configuration", () => {
  const home = mkdtempSync(join(tmpdir(),"engram-assistants-own-"));
  try {
    const results = detectAssistants({home,env:{},path:"",platform:"linux",engramExecutable:process.execPath});
    expect(results.map(result => [result.id,result.configuration.status])).toEqual([
      ["claude-code","absent"],["codex","absent"],["cursor","absent"],["opencode","absent"],["antigravity","absent"],
    ]);
    expect(readdirSync(home)).toEqual([]);
  } finally { rmSync(home,{recursive:true,force:true}); }
});
test("assistant detection reports malformed configuration while continuing other client previews", () => {
  const home = mkdtempSync(join(tmpdir(),"engram-assistants-malformed-"));
  try {
    mkdirSync(join(home,".cursor"));
    writeFileSync(join(home,".cursor","mcp.json"),"{ broken");
    const results = detectAssistants({home,env:{},path:"",platform:"linux",engramExecutable:process.execPath});
    expect(results.find(result => result.id === "cursor")?.configuration.status).toBe("malformed");
    expect(results.find(result => result.id === "codex")?.configuration.status).toBe("absent");
  } finally { rmSync(home,{recursive:true,force:true}); }
});
