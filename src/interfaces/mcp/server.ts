/**
 * Servidor MCP (protocolo de contexto de modelo) que se comunica por entrada y salida estándar (stdio): la forma
 * en que los clientes de IA (Claude Code, etc.) hablan con Forge614 Engram. `commands.ts` lo arranca con
 * `forge614 mcp`; registra las diez herramientas de `tools.ts` y cierra la base de datos de forma ordenada
 * al recibir SIGINT, SIGTERM o el cierre de la entrada estándar.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MemoryStore, MemoryWorkspace, startCloudBackground, type CloudBackgroundTask } from "../../app";
import { MemoryError } from "../../shared/errors";
import { MEMORY_PROTOCOL } from "../../modules/mcp";
import { version } from "../../../package.json";
import { directoryResolver } from "./project-directory";
import { registerTools } from "./tools";

/** Arranca el servidor MCP local por stdio. Abrir SQLite se aplaza hasta la primera llamada a una herramienta. */
export async function startMcp(): Promise<void> {
  let store: MemoryStore | null = null;
  let background: CloudBackgroundTask | null = null;
  let closing = false;
  const memoryStore = () => {
    if (closing) throw new MemoryError("SERVER_CLOSING","El servidor MCP se está cerrando.");
    // Al abrir el store por primera vez (nunca antes: la base sigue sin crearse hasta la primera herramienta),
    // se arranca también la tarea de fondo (D7); `startCloudBackground` no hace nada sin nube configurada.
    if (!store) { store = new MemoryWorkspace().open(); background = startCloudBackground(store); }
    return store;
  };
  const server = new McpServer({ name:"forge614-engram",version }, { instructions:MEMORY_PROTOCOL });

  registerTools(server,memoryStore,directoryResolver(server),() => background?.notifySave());

  const transport = new StdioServerTransport(process.stdin,process.stdout,{ maxBufferSize:256 * 1024 });
  const closeStore = () => { store?.close(); store = null; };
  let shutdownPromise: Promise<void> | null = null;
  // Memoizada: SIGINT, SIGTERM y el cierre de stdin pueden llegar juntos, y el cierre solo debe ejecutarse una vez.
  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    closing = true;
    // La tarea de fondo se detiene ANTES de cerrar el store: un ciclo en vuelo que termine después no debe
    // aplicar nada sobre una base ya cerrada.
    background?.stop(); background = null; closeStore();
    shutdownPromise = server.close().catch(() => {}).finally(closeStore);
    return shutdownPromise;
  };
  process.stdin.once("end",() => { void shutdown(); });
  const stop = (code:number) => { void shutdown().finally(() => process.exit(code)); };
  process.once("SIGINT",() => stop(130));
  process.once("SIGTERM",() => stop(143));
  try { await server.connect(transport); }
  catch (error) { await shutdown(); throw error; }
}
