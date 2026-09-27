/**
 * Detecta cuándo guardar una memoria repetida es en realidad una confirmación (repetir sin cambios
 * refuerza lo ya guardado, en vez de crear una versión nueva) y resuelve las solicitudes de
 * confirmación ya respondidas por su clave.
 */
import type { Database } from "bun:sqlite";
import type { ConfirmationPayload,ConfirmationRequest,MemoryScope } from "../../modules/memory";
import type { Row } from "./memory";
import { schemaFeatures } from "./schema";

/**
 * Indica si el nivel de esquema instalado admite el refuerzo por confirmación.
 * @param db conexión abierta a la base SQLite.
 * @returns true si la base está exactamente en el nivel base 7.
 */
export function reinforcementEnabled(db: Database): boolean {
  return schemaFeatures(db)?.base===7;
}

/**
 * Busca una memoria activa y sin tema (topic_key), del mismo dueño y con el mismo título, contenido,
 * tipo y estado de anclado (pinned) que `owner`, cuya última actividad caiga en la ventana de 15
 * minutos antes de `requestNow`; entre varias candidatas, gana la de actividad más reciente y, en
 * empate, la de menor id.
 * @param db conexión abierta a la base SQLite.
 * @param owner los datos de la memoria propuesta junto con su dueño (proyecto o grupo).
 * @param requestNow instante (ISO) de la solicitud actual.
 * @returns la memoria candidata a confirmar, o null si ninguna califica.
 */
export function confirmationCandidate(db: Database, owner: ConfirmationPayload & {scope:MemoryScope;projectId:string|null;groupId?:string|null}, requestNow: string): Row|null {
  // Límite inferior de la ventana: 15 minutos (900 000 ms) antes de la solicitud actual.
  const earliest=new Date(Date.parse(requestNow)-900_000).toISOString();
  // Las memorias del ecosistema se agrupan por groupId; el resto de ámbitos, por projectId.
  const column=owner.scope==="ecosystem" ? "groupId" : "projectId";
  const ownerId=owner.scope==="ecosystem" ? owner.groupId??null : owner.projectId;
  // La "última actividad" es la confirmación más reciente si hay alguna, o si no, la última edición.
  return db.query(`SELECT m.* FROM memories m
    WHERE m.scope=? AND m.${column} IS ? AND m.topic_key IS NULL AND m.state='active'
      AND m.title=? AND m.content=? AND m.type=? AND m.pinned=?
      AND max(m.updated_at,coalesce((SELECT max(c.recordedAt) FROM confirmations c WHERE c.memoryId=m.id),m.updated_at)) BETWEEN ? AND ?
    ORDER BY max(m.updated_at,coalesce((SELECT max(c.recordedAt) FROM confirmations c WHERE c.memoryId=m.id),m.updated_at)) DESC,m.id ASC
    LIMIT 1`).get(owner.scope,ownerId,owner.title,owner.content,owner.type,Number(owner.pinned),earliest,requestNow) as Row|null;
}

/**
 * Busca una solicitud de confirmación ya respondida por su clave (requestKey), dentro del ámbito y
 * dueño dados.
 * @param db conexión abierta a la base SQLite.
 * @param scope ámbito de la memoria dueña (project, shared o ecosystem).
 * @param ownerId identificador del dueño (proyecto o grupo), o null para el ámbito shared.
 * @param requestKey clave de la solicitud original.
 * @returns la solicitud con su respuesta ya interpretada como JSON, o null si no existe.
 */
export function confirmationRequest(db: Database, scope: MemoryScope, ownerId: string|null, requestKey: string): ConfirmationRequest|null {
  const column=scope==="ecosystem" ? "groupId" : "projectId";
  const row=db.query(`SELECT cr.memoryId,cr.requestKey,cr.payloadHash,cr.expectedVersion,cr.confirmationId,cr.response
    FROM confirmation_requests cr JOIN memories m ON m.id=cr.memoryId
    WHERE m.scope=? AND m.${column} IS ? AND cr.requestKey=?`).get(scope,ownerId,requestKey) as
      {memoryId:string;requestKey:string;payloadHash:string;expectedVersion:number|null;confirmationId:string;response:string}|null;
  return row ? {...row,response:JSON.parse(row.response) as ConfirmationRequest["response"]} : null;
}
