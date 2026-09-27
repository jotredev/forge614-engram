/**
 * Flujo de inicialización del espacio de trabajo en dos pasos (vista previa y aplicación),
 * para que quien ejecuta `setup` pueda ver qué va a cambiar antes de aplicarlo, y para que
 * un cambio de configuración a mitad de camino se detecte en vez de aplicarse a ciegas.
 */
import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { PostgresReplica, postgresOptions } from "../infrastructure/postgres/replica";
import { MemoryError } from "../shared/errors";
import { MemoryWorkspace } from "./workspace";

/** Estado actual del espacio de trabajo, tal como está en disco. */
export interface MemoryInitializationStatus {
  /** Si el espacio de trabajo ya fue inicializado (existe su configuración). */
  readonly initialized: boolean;
  /** Motor de almacenamiento local; siempre `"sqlite"` por ahora. */
  readonly storage: "sqlite";
  /** Si ya hay una URL de PostgreSQL configurada para sincronizar. */
  readonly postgresConfigured: boolean;
  /** Si la base local ya tiene activado el refuerzo de búsqueda. */
  readonly reinforcementEnabled: boolean;
}

/** Lo que la persona pide al ejecutar `setup`. */
export interface MemoryInitializationRequest {
  /** URL de PostgreSQL a configurar, o `null` para no usar sincronización. */
  readonly postgresUrl: string | null;
  /** Si se pide activar el refuerzo de búsqueda. */
  readonly enableReinforcement: boolean;
}

/** Lo que cambiaría si se aplicara la solicitud, calculado sin tocar el disco. */
export interface MemoryInitializationPreview {
  /** Estado del espacio de trabajo antes de aplicar nada. */
  readonly status: MemoryInitializationStatus;
  /** Revisión de la configuración en el momento de la vista previa; se debe reenviar sin cambios a `applyMemoryInitialization`. */
  readonly expectedRevision: string | null;
  /** Si aplicar la solicitud inicializaría el almacenamiento local (aún no existía). */
  readonly initializesStorage: boolean;
  /** Si aplicar la solicitud cambiaría la URL de PostgreSQL configurada. */
  readonly configuresPostgres: boolean;
  /** Si aplicar la solicitud activaría el refuerzo de búsqueda (aún no estaba activado). */
  readonly enablesReinforcement: boolean;
}

/** Lo que efectivamente cambió al aplicar la solicitud. */
export interface MemoryInitializationResult {
  /** Estado del espacio de trabajo después de aplicar los cambios. */
  readonly status: MemoryInitializationStatus;
  /** Si el almacenamiento local se inicializó en esta llamada. */
  readonly initializedStorage: boolean;
  /** Si la URL de PostgreSQL configurada cambió en esta llamada. */
  readonly configuredPostgres: boolean;
  /** Si el refuerzo de búsqueda se activó en esta llamada. */
  readonly enabledReinforcement: boolean;
}

/**
 * Valida la forma de la solicitud y, si trae una URL de PostgreSQL, que sea una URL válida
 * de conexión (sin llegar a conectarse).
 * @throws MemoryError con código `INVALID_INPUT` si la solicitud no tiene la forma esperada,
 * o el error que lance `postgresOptions` si la URL de PostgreSQL no es válida.
 */
function request(value: MemoryInitializationRequest): void {
  if (!value || typeof value !== "object" || (value.postgresUrl !== null && typeof value.postgresUrl !== "string") || typeof value.enableReinforcement !== "boolean") {
    throw new MemoryError("INVALID_INPUT", "La solicitud de inicialización no es válida.");
  }
  if (value.postgresUrl !== null) postgresOptions(value.postgresUrl);
}

/**
 * Lee el estado actual del espacio de trabajo sin modificar nada.
 * @param config Configuración del espacio de trabajo a inspeccionar (por defecto, la del disco).
 * @returns El estado actual; si el espacio de trabajo no existe, todo en `false` salvo `storage`.
 */
export function inspectMemoryInitialization(config = new WorkspaceConfig()): MemoryInitializationStatus {
  if (!config.exists()) {
    return { initialized: false, storage: "sqlite", postgresConfigured: false, reinforcementEnabled: false };
  }
  const settings = config.read();
  const store = new MemoryWorkspace(config).open(true);
  try {
    return {
      initialized: true,
      storage: "sqlite",
      postgresConfigured: settings.postgresUrl !== undefined,
      reinforcementEnabled: store.reinforcementEnabled(),
    };
  } finally { store.close(); }
}

/**
 * Calcula qué cambiaría si se aplicara la solicitud, sin tocar el disco todavía.
 * @param value Solicitud a evaluar.
 * @param config Configuración del espacio de trabajo a evaluar (por defecto, la del disco).
 * @returns La vista previa, incluida la revisión que hay que reenviar a `applyMemoryInitialization`.
 * @throws MemoryError con código `INVALID_INPUT` si `value` no es válido.
 */
export async function previewMemoryInitialization(
  value: MemoryInitializationRequest,
  config = new WorkspaceConfig(),
): Promise<MemoryInitializationPreview> {
  request(value);
  const status = inspectMemoryInitialization(config);
  const currentPostgresUrl = status.initialized ? (config.read().postgresUrl ?? null) : null;
  return {
    status,
    expectedRevision: config.revision(),
    initializesStorage: !status.initialized,
    configuresPostgres: currentPostgresUrl !== value.postgresUrl,
    enablesReinforcement: value.enableReinforcement && !status.reinforcementEnabled,
  };
}

/**
 * Comprueba que la URL de PostgreSQL dada sirve para conectarse y crear el esquema de
 * sincronización si hace falta (con `create=true`), sin dejar la conexión abierta.
 * @param url URL de PostgreSQL a validar, o `null` para no validar nada.
 */
async function validatePostgres(url: string | null): Promise<void> {
  if (url === null) return;
  const replica = await PostgresReplica.connect(url, true);
  try { await replica.read(); }
  finally { await replica.close(); }
}

/**
 * Aplica de verdad la solicitud: inicializa el almacenamiento si hacía falta, activa los
 * vínculos de carpeta a proyecto, configura (o quita) PostgreSQL y activa el refuerzo de
 * búsqueda si se pidió.
 * @param value Solicitud a aplicar.
 * @param expectedRevision Revisión que devolvió la vista previa; si la configuración cambió
 * desde entonces, se rechaza en vez de aplicar sobre una base distinta a la que se mostró.
 * @param config Configuración del espacio de trabajo a modificar (por defecto, la del disco).
 * @returns Lo que efectivamente cambió y el estado resultante.
 * @throws MemoryError con código `INVALID_INPUT` si `value` no es válido; `CONFIG_CHANGED` si
 * la configuración ya no coincide con `expectedRevision`.
 */
export async function applyMemoryInitialization(
  value: MemoryInitializationRequest,
  expectedRevision: string | null,
  config = new WorkspaceConfig(),
): Promise<MemoryInitializationResult> {
  request(value);
  const before = inspectMemoryInitialization(config);
  const currentPostgresUrl = before.initialized ? (config.read().postgresUrl ?? null) : null;
  if (config.revision() !== expectedRevision) {
    throw new MemoryError("CONFIG_CHANGED", "La configuración cambió; genera una vista previa nueva antes de aplicar cambios.");
  }
  // Se valida PostgreSQL antes de tocar el disco local, para no dejar el espacio de trabajo a medio inicializar si la URL fuera inválida.
  await validatePostgres(value.postgresUrl);
  const workspace = new MemoryWorkspace(config);
  workspace.init();
  const initializedStore = workspace.open();
  try { initializedStore.enableProjectBindings(); }
  finally { initializedStore.close(); }
  config.configurePostgres(value.postgresUrl, config.revision());
  if (value.enableReinforcement && !before.reinforcementEnabled) {
    const store = workspace.open();
    try { store.enableSearchReinforcement(); }
    finally { store.close(); }
  }
  return {
    status: inspectMemoryInitialization(config),
    initializedStorage: !before.initialized,
    configuredPostgres: currentPostgresUrl !== value.postgresUrl,
    enabledReinforcement: value.enableReinforcement && !before.reinforcementEnabled,
  };
}
