/**
 * Comandos de control de la nube (D9, D13, D14) para `forge614 cloud on/off/status` y para que
 * `sync`/`sync-watch` corran el ciclo nuevo cuando la nube está activa. Vive en `src/app` (y no en
 * `src/interfaces/cli/commands.ts`, donde el plan pone su firma) porque las reglas de capas
 * (`tests/architecture/import-rules.ts`) prohíben que una interfaz importe infraestructura
 * directamente (`WorkspaceConfig`, `PostgresReplica`); `commands.ts` llama a `runCloudOn`,
 * `runCloudOff`, `runCloudStatus` y `runCloudSync`, y `sync-watch.ts` llama además a
 * `runCloudSync`, ambos a través de `src/app/index.ts`, igual que al resto de la capa de aplicación.
 */
import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { PostgresReplica } from "../infrastructure/postgres/replica";
import { MemoryError } from "../shared/errors";
import { MemoryWorkspace } from "./workspace";
import { cloudSettings, connectCloudReplica } from "./cloud-settings";

/** Resultado de `cloud on`: el id de instalación (nuevo o ya existente) y que la nube quedó activa. */
export interface CloudOnResult { readonly installationId: string; readonly enabled: true }
/** Resultado de `cloud off`: la nube queda desactivada; ni el id de instalación ni la base de nivel 12 se tocan. */
export interface CloudOffResult { readonly enabled: false }
/** Resultado de `cloud status`: si la nube está activa y, si la base ya llegó al nivel 12, sus cifras (Foco de revisión #4: se dan aunque la nube esté apagada). */
export interface CloudStatusResult {
  /** Nivel 12 y dirección presente; `false` si falta cualquiera de las dos, aunque la base tenga cola. */
  readonly enabled: boolean;
  /** Id de instalación (D9), o `null` si la base nunca llegó al nivel 12. */
  readonly installationId: string | null;
  /** Último cambio bajado de la nube y aplicado, o `null` sin nivel 12. */
  readonly lastAppliedId: number | null;
  /** Cuántas filas quedan por subir en `cloud_outbox`; 0 sin nivel 12. */
  readonly pending: number;
  /** Fecha de creación del pendiente más viejo, o `null` si no hay ninguno. */
  readonly oldestPendingAt: string | null;
}
/** Resultado de un ciclo de `sync` con el mecanismo nuevo: cuántos cambios se subieron y cuántos se bajaron. */
export interface CloudSyncResult { readonly uploaded: number; readonly downloaded: number }

/**
 * Reduce una URL de PostgreSQL ya validada a la huella que D14 usa para reconocer si `cloud on`
 * apunta a la base de siempre o a una distinta: host en minúsculas, puerto explícito (5432 si
 * falta) y nombre de base, sin usuario ni contraseña (la huella puede quedar en la base local, y
 * D13 exige que la dirección completa nunca se guarde en texto donde no haga falta).
 * @param url URL de conexión ya validada por `postgresOptions` (vía `PostgresReplica.connect`).
 * @returns La huella `host:puerto/base`.
 */
function remoteFingerprint(url: string): string {
  const parsed = new URL(url);
  const port = parsed.port || "5432";
  const database = decodeURIComponent(parsed.pathname.slice(1));
  return `${parsed.hostname.toLowerCase()}:${port}/${database}`;
}

/**
 * Activa la sincronización con la nube (D9). Exige que `init` ya se haya ejecutado; prueba la
 * conexión y la cierra ANTES de escribir nada (una URL que no sirve no debe dejar rastro); genera
 * el id de instalación solo si todavía no existía (repetir la llamada no lo cambia); y activa el
 * nivel de esquema 12 con la huella de la base remota, para que D14 decida si es la misma nube de
 * siempre (conserva la cola y `lastAppliedId`) o una distinta (reencola toda la memoria local y
 * baja `lastAppliedId` a 0).
 * @param url URL de conexión a PostgreSQL, ya sea de `--postgres-url` o leída de la entrada estándar.
 * @param config Configuración del espacio de trabajo a modificar (por defecto, la del disco).
 * @throws MemoryError con código `CONFIG_NOT_FOUND` si `init` no se ejecutó todavía; con
 * `POSTGRES_URL` o `POSTGRES_UNAVAILABLE` si la URL no sirve para conectarse.
 */
export async function runCloudOn(url: string, config = new WorkspaceConfig()): Promise<CloudOnResult> {
  if (!config.exists()) throw new MemoryError("CONFIG_NOT_FOUND", "Ejecuta init antes de cloud on.");
  // La conexión se prueba y se cierra ANTES de escribir nada: una dirección que no sirve no deja huella.
  const probe = await PostgresReplica.connect(url, true);
  await probe.close();
  const existing = config.read();
  const installationId = existing.installationId ?? crypto.randomUUID();
  config.configurePostgres(url, config.revision(), installationId);
  const workspace = new MemoryWorkspace(config);
  const store = workspace.open();
  try { store.enableCloud(remoteFingerprint(url)); }
  finally { store.close(); }
  return { installationId, enabled: true };
}

/**
 * Desactiva la sincronización con la nube (D9): quita `POSTGRES_URL` del `.env` conservando el id
 * de instalación; la base sigue en nivel 12 con su cola intacta (Foco de revisión #4), lista para
 * que una `cloud on` posterior con la misma base la retome donde se quedó.
 * @param config Configuración del espacio de trabajo a modificar (por defecto, la del disco).
 * @throws MemoryError con código `CONFIG_NOT_FOUND` si no hay configuración guardada todavía.
 */
export async function runCloudOff(config = new WorkspaceConfig()): Promise<CloudOffResult> {
  const existing = config.read();
  config.configurePostgres(null, config.revision(), existing.installationId ?? null);
  return { enabled: false };
}

/**
 * Reporta el estado de la nube sin conectarse a ella. `enabled` exige nivel 12 Y dirección
 * presente; las cifras de la cola (`lastAppliedId`, `pending`, `oldestPendingAt`) se dan siempre
 * que la base ya llegó al nivel 12, esté la nube prendida o apagada (Foco de revisión #4: `cloud
 * off` con pendientes en la cola sigue mostrándolos).
 * @param config Configuración del espacio de trabajo a leer (por defecto, la del disco).
 */
export function runCloudStatus(config = new WorkspaceConfig()): CloudStatusResult {
  if (!config.exists()) return { enabled: false, installationId: null, lastAppliedId: null, pending: 0, oldestPendingAt: null };
  const settings = config.read();
  const workspace = new MemoryWorkspace(config);
  const store = workspace.open(true);
  try {
    if (!store.cloudEnabled()) return { enabled: false, installationId: settings.installationId ?? null, lastAppliedId: null, pending: 0, oldestPendingAt: null };
    const queue = store.cloudQueueStatus();
    return { enabled: settings.postgresUrl !== undefined, installationId: settings.installationId ?? null, lastAppliedId: queue.lastAppliedId, pending: queue.pending, oldestPendingAt: queue.oldestPendingAt };
  } finally { store.close(); }
}

/**
 * Un ciclo de `sync` con el mecanismo nuevo (D7, D10): sube la cola pendiente y baja los cambios
 * nuevos, usando `connectCloudReplica` sobre la conexión ya validada por `cloud on`. La usan `sync`
 * y `sync-watch` cuando `cloudSettings()` da datos completos (la instalación ya pasó por `cloud
 * on`); sin eso, ambos siguen con el mecanismo local anterior (formatos 1-3).
 * @throws MemoryError con código `SYNC_DISABLED` si no hay nube configurada en el `.env`, o si el
 * `.env` la tiene pero la base local nunca pasó por `cloud on` (nivel de esquema 12): sin esta
 * comprobación, la base fallaría con un error crudo de SQLite («no such table») en vez de un aviso claro.
 */
export async function runCloudSync(): Promise<CloudSyncResult> {
  const settings = cloudSettings();
  if (!settings) throw new MemoryError("SYNC_DISABLED", "La sincronización con la nube no está configurada. Ejecuta cloud on.");
  const workspace = new MemoryWorkspace();
  const store = workspace.open();
  try {
    if (!store.cloudEnabled()) throw new MemoryError("SYNC_DISABLED", "La sincronización con la nube no está configurada. Ejecuta cloud on.");
    const replica = await connectCloudReplica(settings.postgresUrl);
    // "Subidos" y "bajados" son los que de verdad subió y aplicó el ciclo, no el avance de `lastAppliedId`
    // (que también cuenta filas propias que vuelven al bajar y filas saltadas, y por eso mentía antes).
    try { return await store.syncCloudCycle(replica, settings.installationId); }
    finally { await replica.close(); }
  } finally { store.close(); }
}
