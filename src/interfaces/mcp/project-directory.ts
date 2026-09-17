import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertGitProjectDirectory } from "../../app";
import { MemoryError } from "../../shared/errors";

export function directoryResolver(server:McpServer) {
  async function selectedDirectory(explicit?: string): Promise<{ directory:string; implicitCwd:boolean }> {
    if (explicit !== undefined) return { directory:explicit,implicitCwd:false };
    const rootsCapability = server.server.getClientCapabilities()?.roots;
    if (rootsCapability) {
      const roots = (await server.server.listRoots()).roots;
      if (roots.length > 1) throw new MemoryError("AMBIGUOUS_PROJECT","Varias raíces MCP requieren indicar directory explícitamente.");
      if (roots.length === 1) {
        let url: URL;
        try { url = new URL(roots[0]!.uri); }
        catch { throw new MemoryError("INVALID_DIRECTORY","La raíz MCP no es una URL de archivo válida."); }
        if (url.protocol !== "file:") throw new MemoryError("INVALID_DIRECTORY","La raíz MCP debe ser una carpeta file:// local.");
        return { directory:fileURLToPath(url),implicitCwd:false };
      }
    }
    return { directory:process.cwd(),implicitCwd:true };
  }
  async function projectDirectory(explicit?: string): Promise<string> {
    const selected = await selectedDirectory(explicit);
    if (selected.implicitCwd) {
      try {
        if (realpathSync(selected.directory) === realpathSync(dirname(process.execPath))) {
          throw new MemoryError("PROJECT_DIRECTORY_REQUIRED","La carpeta del ejecutable no se usa como proyecto implícito.");
        }
      } catch (error) {
        if (error instanceof MemoryError) throw error;
      }
      assertGitProjectDirectory(selected.directory);
    }
    return selected.directory;
  }

  return projectDirectory;
}
