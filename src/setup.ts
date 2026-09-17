import { WorkspaceConfig } from "./workspace-config";
import { MemoryWorkspace } from "./workspace";

export interface SetupIO {
  write(message: string): void;
  ask(question: string): Promise<string | null>;
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
  const ask = async (question: string): Promise<string> => {
    const answer = await io.ask(question);
    if (answer === null || ["q", "cancelar"].includes(answer.trim().toLowerCase())) throw new Cancelled();
    return answer.trim();
  };
  try {
    io.write("Forge614 Engram — configuración guiada\nEscribe cancelar o q, o pulsa Ctrl+C, para salir antes de confirmar.");
    io.write(`Una configuración global: ${display(config.root + "/.env")}\nUna base SQLite para todos los proyectos: ${display(config.databasePath)}`);
    io.write("SQLite guarda tus recuerdos en este equipo. PostgreSQL todavía no está disponible. No se pedirán credenciales ni se conectarán asistentes en este paso.");
    const configured = config.exists();
    if (configured) {
      const store = workspace.open(true); // Validate existing storage without listing projects.
      store.close();
    }
    io.write(configured
      ? "Configuración existente validada. Se conservarán la configuración y los recuerdos."
      : "Se preparará el espacio global al confirmar. Una base existente solo se reutilizará si es compatible; nunca se borrará ni reemplazará.");
    io.write("Resumen: configurar el almacenamiento global SQLite. No se crearán ni seleccionarán proyectos y no se borrarán datos.");
    while (true) {
      const confirmation = (await ask("¿Confirmar? [si/NO]: ")).toLowerCase();
      if (["", "no", "n"].includes(confirmation)) throw new Cancelled();
      if (["si", "sí", "s", "yes", "y"].includes(confirmation)) break;
      io.write("Responde si para confirmar o no para cancelar.");
    }
    workspace.init(); // Revalidate after confirmation; never replace a missing configured database.
    io.write("Configuración global lista. No necesitas elegir un proyecto para configurar Engram.");
    io.write("La identificación de proyectos y el guardado automático con asistentes siguen pendientes de integración.");
    return { cancelled: false, storage: "sqlite" };
  } catch (error) {
    if (!(error instanceof Cancelled)) throw error;
    io.write("Configuración cancelada. No se aplicaron cambios de configuración, proyectos ni recuerdos.");
    return { cancelled: true };
  }
}
