export type CapabilityState = {
  schema: 3 | 4 | 5 | 6 | 7;
  assistantIntegration: boolean;
  sessions: boolean;
  reinforcement: boolean;
};

export type ProjectSummary = {
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  bindings: string[];
  memories: {active:number; archived:number; lastUpdatedAt:string|null};
};

export type SharedSummary = {active:number; archived:number; lastUpdatedAt:string|null};

export type StorageSummary = {
  initialized: boolean;
  databasePath: string | null;
  capabilities: CapabilityState | null;
  postgres: "not-configured" | "configured";
};

export type ControlCenterSnapshot = {
  storage: StorageSummary;
  projects: ProjectSummary[];
  shared: SharedSummary | null;
};

export type ControlCenterMutation =
  | {kind:"create-project"; name:string}
  | {kind:"rename-project"; projectId:string; name:string}
  | {kind:"bind-directory"; projectId:string; directory:string}
  | {kind:"enable-integration" | "enable-sessions" | "enable-reinforcement"}
  | {kind:"sync-now"};
