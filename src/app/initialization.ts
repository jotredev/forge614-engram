import { WorkspaceConfig } from "../infrastructure/filesystem/workspace-config";
import { postgresOptions } from "../infrastructure/postgres/replica";
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
