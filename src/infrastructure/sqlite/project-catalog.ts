import type { Database } from "bun:sqlite";
import { readBoundOrigin } from "../git/remote-origin";
import { legacyOriginKey, normalizeIdentityOrigin, type Project } from "../../modules/projects";
import { schemaFeatures } from "./schema";

type OriginCandidate = { project: Project; verified: boolean };
type OriginRow = Project & { verified: 0 | 1 };

/** Busca una clave normalizada y conserva la distinción entre identidad confirmada y pista histórica. */
export function findProjectsByOrigin(db: Database, origin: string): OriginCandidate[] {
  const schema = schemaFeatures(db);
  if (!schema?.projectIdentity && !schema?.cloud) return [];
  const legacy = legacyOriginKey(origin);
  const hints = `SELECT p.*, 0 AS verified FROM project_remotes r JOIN projects p ON p.projectId=r.project_id
    WHERE r.origin IN (?, ?)`;
  const records = schema.projectIdentity
    ? db.query(`SELECT p.*, 1 AS verified FROM project_identity_settings s JOIN projects p ON p.projectId=s.project_id
        WHERE s.setting='origin' AND s.value=?
      UNION ALL
      ${hints} AND NOT EXISTS (
        SELECT 1 FROM project_identity_settings s WHERE s.project_id=r.project_id AND s.setting='origin'
      )
      ORDER BY projectId`).all(origin, origin, legacy)
    : db.query(`${hints} ORDER BY p.projectId`).all(origin, legacy);
  return (records as OriginRow[]).map(({ verified, ...project }) => ({ project, verified: verified === 1 }));
}

function putOrigin(db: Database, projectId: string, origin: string, updatedAt: string): void {
  db.query(`INSERT INTO project_identity_settings(project_id,setting,value,updated_at) VALUES(?,'origin',?,?)
    ON CONFLICT(project_id,setting) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
    WHERE project_identity_settings.value<>excluded.value`).run(projectId, origin, updatedAt);
}

/** Guarda una adjudicación ya validada y mantiene la copia que entienden los clientes anteriores. */
export function setConfirmedProjectOrigin(db: Database, projectId: string, origin: string): void {
  const updatedAt = new Date().toISOString();
  putOrigin(db, projectId, origin, updatedAt);
  db.query(`INSERT INTO project_remotes(project_id,origin,updated_at) VALUES(?,?,?)
    ON CONFLICT(project_id) DO UPDATE SET origin=excluded.origin,updated_at=excluded.updated_at
    WHERE project_remotes.origin<>excluded.origin`).run(projectId, legacyOriginKey(origin), updatedAt);
}

/** Recupera una clave única aportada por los vínculos Git y exige concordancia si hay una pista histórica. */
export function backfillProjectOrigins(db: Database): void {
  const bindings = db.query(`SELECT b.projectId AS project_id, r.origin, b.directory FROM project_bindings b
    LEFT JOIN project_remotes r ON r.project_id=b.projectId ORDER BY b.projectId, b.directory`).all() as
    { project_id: string; origin: string | null; directory: string }[];
  const evidence = new Map<string, { legacy: string | null; origins: Set<string> }>();
  for (const { project_id, origin, directory } of bindings) {
    const raw = readBoundOrigin(directory);
    const key = raw === null ? null : normalizeIdentityOrigin(raw);
    if (key === null) continue;
    const entry = evidence.get(project_id) ?? { legacy: origin, origins: new Set<string>() };
    entry.origins.add(key);
    evidence.set(project_id, entry);
  }
  const now = new Date().toISOString();
  // La copia histórica y su cola de réplica se conservan tal como estaban.
  for (const [projectId, { legacy, origins }] of evidence) {
    if (origins.size !== 1) continue;
    const [key] = origins;
    if (legacy === null) setConfirmedProjectOrigin(db, projectId, key!);
    else if (legacyOriginKey(key!) === legacy) putOrigin(db, projectId, key!, now);
  }
}
