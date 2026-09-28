/**
 * Punto único de construcción de la configuración de nube (D9): lee `~/.forge614/engram/.env` (o el
 * equivalente configurado por `FORGE614_HOME`) y da la URL de PostgreSQL y el id de instalación ya
 * validados, o `null` si no hay nube configurada todavía. También arma la conexión perezosa por
 * defecto hacia esa URL. La usan `cloud-background.ts` y el CLI (`startup-context` en
 * `src/interfaces/cli/commands.ts`) para decidir si hay nube antes de conectar nada.
 */
import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { PostgresReplica } from "../infrastructure/postgres/replica";
import { MemoryError } from "../shared/errors";
import type { CloudReplica } from "./cloud-sync";

/** Los dos datos que hacen falta para hablar con la nube: la URL de conexión y el id de esta instalación. */
export interface CloudSettings {
  /** URL completa de conexión a PostgreSQL, ya validada por `WorkspaceConfig.read()`. */
  readonly postgresUrl: string;
  /** UUID que identifica a esta instalación de Engram frente a las demás que comparten la misma nube (D9). */
  readonly installationId: string;
}

/**
 * Lee la configuración guardada y da los datos de nube si están completos.
 * @returns `{postgresUrl, installationId}` si la configuración guardada trae los dos datos; `null` si
 * no hay configuración guardada, o si la guardada no tiene nube (solo SQLite, o SQLite con réplica
 * pero sin id de instalación todavía asignado por `cloud on`).
 * @throws Cualquier error que no sea de configuración (`MemoryError`); un error de configuración se
 * trata como «sin nube», nunca como un fallo del arranque.
 */
export function cloudSettings(): CloudSettings | null {
  let settings;
  try { settings = new WorkspaceConfig().read(); }
  catch (error) { if (error instanceof MemoryError) return null; throw error; }
  if (!settings.postgresUrl || !settings.installationId) return null;
  return { postgresUrl: settings.postgresUrl, installationId: settings.installationId };
}

/**
 * Conexión perezosa por defecto hacia la réplica de PostgreSQL: la que usa la tarea de fondo cuando
 * ninguna prueba inyecta un doble (`CloudBackgroundOptions.connect`).
 * @param url URL de conexión a PostgreSQL, tal como la da {@link cloudSettings}.
 * @returns Una réplica ya conectada.
 */
export function connectCloudReplica(url: string): Promise<CloudReplica> {
  return PostgresReplica.connect(url);
}
