import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { MemoryWorkspace } from "./workspace";
import { PostgresReplica, postgresOptions } from "../infrastructure/postgres/replica";
import { MemoryError } from "../shared/errors";

export interface SetupIO {
  write(message: string): void;
  ask(question: string, options?: {secret:boolean}): Promise<string | null>;
}
export type SetupResult = { cancelled: true } | { cancelled: false; storage: "sqlite" };

class Cancelled extends Error {}
// Escape paths before displaying them in the terminal.
function display(text: string): string {
  return JSON.stringify(text).replace(/[\x7f-\x9f\u2028-\u202e\u2066-\u2069]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export async function runSetup(io: SetupIO, config = new WorkspaceConfig()): Promise<SetupResult> {
  const workspace = new MemoryWorkspace(config);
  const ask = async (question: string, secret=false): Promise<string> => {
    const answer = await io.ask(question,{secret});
    if (answer === null || ["q", "cancelar"].includes(answer.trim().toLowerCase())) throw new Cancelled();
    return answer.trim();
  };
  try {
    io.write("Forge614 Engram — configuración guiada\nEscribe cancelar o q, o pulsa Ctrl+C, para salir antes de confirmar.");
    io.write(`Una configuración global: ${display(config.root + "/.env")}\nUna base SQLite para todos los proyectos: ${display(config.databasePath)}`);
    io.write("SQLite y FTS5 siempre guardan y buscan en este equipo, incluso sin conexión. PostgreSQL permite sincronizar una copia; no reemplaza SQLite.");
    config.repairExistingRoot();
    const configured = config.exists();
    const revision=config.revision();
    let reinforcementEnabled=false;
    if (configured) {
      const store = workspace.open(true); // Validate existing storage without listing projects.
      try { reinforcementEnabled=store.reinforcementEnabled(); }
      finally { store.close(); }
    }
    io.write(configured
      ? "Configuración existente validada. Se conservarán la configuración y los recuerdos."
      : "Se preparará el espacio global al confirmar. Una base existente solo se reutilizará si es compatible; nunca se borrará ni reemplazará.");
    const current=configured?config.read().postgresUrl:undefined;
    if(current) io.write('La sincronización PostgreSQL está configurada. Elegir «No» la desactiva sin borrar ninguna copia; «Sí» permite conservar o cambiar la conexión.');
    io.write("¿Quieres habilitar la sincronización con una base de datos PostgreSQL?\nNo\nSí, configurar PostgreSQL");
    let postgresUrl:string|null=null;
    while(true) {
      const answer=(await ask("Elige [si/NO]: ")).toLowerCase();
      if(["","no","n"].includes(answer)) break;
      if(["si","sí","s","yes","y"].includes(answer)) {
        while(true) {
          const url=await ask(current?"URL PostgreSQL (oculta; Enter conserva la actual): ":"URL PostgreSQL (entrada oculta): ",true);
          if(!url&&current) {postgresUrl=current;break;}
          try {postgresOptions(url);postgresUrl=url;break;}
          catch {io.write("URL inválida. Usa postgres:// o postgresql:// con usuario y base; TLS verificado salvo loopback explícito.");}
        }
        break;
      }
      io.write("Responde si o no.");
    }
    if(postgresUrl) io.write("Se sincronizará el espacio completo: todos los proyectos, recuerdos shared e historial. Usa una base PostgreSQL dedicada, vacía o ya compatible. Los equipos con acceso a esa base podrán recibir estos datos. No se transmite nada antes de confirmar.");
    else io.write("Sincronización PostgreSQL desactivada; se conservarán todas las copias existentes.");
    let enableReinforcement=reinforcementEnabled;
    if(reinforcementEnabled) {
      io.write("El refuerzo de recuerdos ya está habilitado. Se conservará habilitado; esta configuración no ofrece una degradación.");
    } else {
      io.write("registrar repeticiones mejora el orden; no verifica la verdad.");
      io.write("sincronizar esta función requiere actualizar todos los equipos.");
      io.write("¿Quieres habilitar el refuerzo de recuerdos? [si/NO]");
      while(true) {
        const answer=(await ask("Elige [si/NO]: ")).toLowerCase();
        if(["","no","n"].includes(answer)) break;
        if(["si","sí","s","yes","y"].includes(answer)) {enableReinforcement=true;break;}
        io.write("Responde si o no.");
      }
    }
    io.write(`Resumen: configurar el almacenamiento global SQLite${enableReinforcement?" y mantener habilitado el refuerzo de recuerdos":""}. No se crearán ni seleccionarán proyectos y no se borrarán datos.`);
    while (true) {
      const confirmation = (await ask("¿Confirmar? [si/NO]: ")).toLowerCase();
      if (["", "no", "n"].includes(confirmation)) throw new Cancelled();
      if (["si", "sí", "s", "yes", "y"].includes(confirmation)) break;
      io.write("Responde si para confirmar o no para cancelar.");
    }
    if(config.revision()!==revision) throw new MemoryError("CONFIG_CHANGED","La configuración cambió; ejecuta init de nuevo.");
    if(postgresUrl) {
      const replica=await PostgresReplica.connect(postgresUrl,true);
      try {await replica.read();} finally {await replica.close();}
    }
    if(config.revision()!==revision) throw new MemoryError("CONFIG_CHANGED","La configuración cambió; ejecuta init de nuevo.");
    workspace.init(); // Revalidate after confirmation; never replace a missing configured database.
    const initializedStore=workspace.open();
    try { initializedStore.enableProjectBindings(); }
    finally { initializedStore.close(); }
    if(postgresUrl||enableReinforcement) {
      const store=workspace.open();
      try {
        if(enableReinforcement) store.enableSearchReinforcement();
        else store.enableSync();
      } finally {store.close();}
    }
    config.configurePostgres(postgresUrl,revision??config.revision());
    io.write("Configuración global lista. No necesitas elegir un proyecto para configurar Engram.");
    if(enableReinforcement) io.write("El refuerzo de recuerdos está habilitado. Para promover una réplica remota ejecuta por separado forge614-engram sync --upgrade-format, después de actualizar todos los equipos para que entiendan el formato 3.");
    if(postgresUrl) io.write("Ejecuta forge614-engram sync para sincronizar ahora, o forge614-engram sync-watch para reintentar automáticamente mientras esté abierto. No se instaló un servicio permanente.");
    io.write("MCP permite identificar proyectos y guardar recuerdos; el modelo puede omitir guardados y no se garantiza un resumen al cerrar.");
    return { cancelled: false, storage: "sqlite" };
  } catch (error) {
    if (!(error instanceof Cancelled)) throw error;
    io.write("Configuración cancelada. No se aplicaron cambios de configuración, proyectos ni recuerdos.");
    return { cancelled: true };
  }
}
