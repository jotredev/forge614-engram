import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { PostgresReplica, postgresOptions } from "../infrastructure/postgres/replica";
import { MemoryError } from "../shared/errors";
import { MemoryWorkspace } from "./workspace";

export interface MemoryInitializationStatus {
  readonly initialized: boolean;
  readonly storage: "sqlite";
  readonly postgresConfigured: boolean;
  readonly reinforcementEnabled: boolean;
}

export interface MemoryInitializationRequest {
  readonly postgresUrl: string | null;
  readonly enableReinforcement: boolean;
}

export interface MemoryInitializationPreview {
  readonly status: MemoryInitializationStatus;
  readonly expectedRevision: string | null;
  readonly initializesStorage: boolean;
  readonly configuresPostgres: boolean;
  readonly enablesReinforcement: boolean;
}

export interface MemoryInitializationResult {
  readonly status: MemoryInitializationStatus;
  readonly initializedStorage: boolean;
  readonly configuredPostgres: boolean;
  readonly enabledReinforcement: boolean;
}

function request(value: MemoryInitializationRequest): void {
  if (!value || typeof value !== "object" || (value.postgresUrl !== null && typeof value.postgresUrl !== "string") || typeof value.enableReinforcement !== "boolean") {
    throw new MemoryError("INVALID_INPUT", "La solicitud de inicialización no es válida.");
  }
  if (value.postgresUrl !== null) postgresOptions(value.postgresUrl);
}

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

async function validatePostgres(url: string | null): Promise<void> {
  if (url === null) return;
  const replica = await PostgresReplica.connect(url, true);
  try { await replica.read(); }
  finally { await replica.close(); }
}

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
  await validatePostgres(value.postgresUrl);
  const workspace = new MemoryWorkspace(config);
  workspace.init();
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
