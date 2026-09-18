import type { Database } from "bun:sqlite";
import type { CapabilityState, ControlCenterSnapshot, ProjectSummary, SharedSummary } from "../../modules/control-center";
import { MemoryError } from "../../shared/errors";
import { reinforcementEnabled } from "./confirmations";
import { sessionsEnabled } from "./sessions";

type ControlCenterData = Pick<ControlCenterSnapshot, "projects" | "shared"> & {capabilities:CapabilityState};
type ProjectRow = Omit<ProjectSummary, "bindings" | "memories"> & {
  active: number;
  archived: number;
  lastUpdatedAt: string | null;
};

function schemaVersion(db: Database): CapabilityState["schema"] {
  const version = (db.query("PRAGMA user_version").get() as {user_version:number}).user_version;
  switch (version) {
    case 3: case 4: case 5: case 6: case 7: return version;
    default: throw new MemoryError("DATABASE_VERSION", "Base incompatible: no se puede abrir con esta versión.");
  }
}

export function readControlCenter(db: Database): ControlCenterData {
  const schema = schemaVersion(db);
  const capabilities: CapabilityState = {
    schema,
    assistantIntegration: schema >= 5,
    sessions: sessionsEnabled(db),
    reinforcement: reinforcementEnabled(db),
  };
  const rows = db.query(`SELECT p.projectId,p.name,p.createdAt,p.updatedAt,
      sum(CASE WHEN m.state='active' THEN 1 ELSE 0 END) AS active,
      sum(CASE WHEN m.state='archived' THEN 1 ELSE 0 END) AS archived,
      max(m.updated_at) AS lastUpdatedAt
    FROM projects p
    LEFT JOIN memories m ON m.projectId=p.projectId AND m.scope='project'
    GROUP BY p.projectId,p.name,p.createdAt,p.updatedAt
    ORDER BY p.name,p.projectId`).all() as ProjectRow[];
  const bindings = new Map<string,string[]>();
  if (capabilities.assistantIntegration) {
    const bindingRows = db.query("SELECT projectId,directory FROM project_bindings ORDER BY projectId,directory")
      .all() as {projectId:string; directory:string}[];
    for (const binding of bindingRows) {
      const projectBindings = bindings.get(binding.projectId) ?? [];
      projectBindings.push(binding.directory);
      bindings.set(binding.projectId, projectBindings);
    }
  }
  const projects = rows.map(({active, archived, lastUpdatedAt, ...project}): ProjectSummary => ({
    ...project,
    bindings: bindings.get(project.projectId) ?? [],
    memories: {active, archived, lastUpdatedAt},
  }));
  const shared = db.query(`SELECT
      coalesce(sum(CASE WHEN state='active' THEN 1 ELSE 0 END),0) AS active,
      coalesce(sum(CASE WHEN state='archived' THEN 1 ELSE 0 END),0) AS archived,
      max(updated_at) AS lastUpdatedAt
    FROM memories WHERE projectId IS NULL`).get() as SharedSummary;
  return {capabilities, projects, shared};
}
