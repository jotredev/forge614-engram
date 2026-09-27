/**
 * Resuelve el directorio de proyecto que usará cada llamada MCP (protocolo de contexto de modelo): un directorio
 * explícito si la herramienta lo recibe, la raíz (root) única que el cliente MCP anuncie, o el directorio de
 * trabajo (cwd) del proceso como último recurso. Lo usa `server.ts` para construir la función `projectDirectory`
 * del contexto de herramientas (`ToolContext`, en `context.ts`).
 */
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertGitProjectDirectory } from "../../app";
import { MemoryError } from "../../shared/errors";

/** Construye, para un servidor MCP dado, la función `projectDirectory` que resuelve el directorio de cada llamada. */
export function directoryResolver(server:McpServer) {
  /**
   * Elige el directorio antes de validarlo: si viene explícito lo usa tal cual; si no, mira las raíces (roots)
   * que el cliente MCP anuncia. Con más de una raíz no puede elegir sola (código `AMBIGUOUS_PROJECT`); con
   * ninguna, cae al directorio de trabajo del proceso y lo marca como implícito para que `projectDirectory` lo valide.
   */
  async function selectedDirectory(explicit?: string): Promise<{ directory:string; implicitCwd:boolean }> {
    if (explicit !== undefined) return { directory:explicit,implicitCwd:false };
    const rootsCapability = server.server.getClientCapabilities()?.roots;
    if (rootsCapability) {
      const roots = (await server.server.listRoots()).roots;
      if (roots.length > 1) throw new MemoryError("AMBIGUOUS_PROJECT","Varias raíces MCP requieren indicar directory explícitamente.");
      if (roots.length === 1) {
        // La raíz llega como URI file://; solo se acepta si es una URL de archivo válida y con ese esquema.
        let url: URL;
        try { url = new URL(roots[0]!.uri); }
        catch { throw new MemoryError("INVALID_DIRECTORY","La raíz MCP no es una URL de archivo válida."); }
        if (url.protocol !== "file:") throw new MemoryError("INVALID_DIRECTORY","La raíz MCP debe ser una carpeta file:// local.");
        return { directory:fileURLToPath(url),implicitCwd:false };
      }
    }
    return { directory:process.cwd(),implicitCwd:true };
  }
  /**
   * Resuelve el directorio final: si `selectedDirectory` lo tomó del directorio de trabajo (implícito), lo valida
   * antes de aceptarlo. Rechaza la carpeta del propio ejecutable (código `PROJECT_DIRECTORY_REQUIRED`, evita usar
   * por accidente la carpeta de instalación como proyecto) y exige que sea un repositorio Git (`assertGitProjectDirectory`).
   */
  async function projectDirectory(explicit?: string): Promise<string> {
    const selected = await selectedDirectory(explicit);
    if (selected.implicitCwd) {
      try {
        if (realpathSync(selected.directory) === realpathSync(dirname(process.execPath))) {
          throw new MemoryError("PROJECT_DIRECTORY_REQUIRED","La carpeta del ejecutable no se usa como proyecto implícito.");
        }
      } catch (error) {
        // Si falla por otra razón (p. ej. una ruta que no existe), no es este caso: se ignora y sigue a la validación de Git.
        if (error instanceof MemoryError) throw error;
      }
      assertGitProjectDirectory(selected.directory);
    }
    return selected.directory;
  }

  return projectDirectory;
}
