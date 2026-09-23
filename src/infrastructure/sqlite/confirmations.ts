import type { Database } from "bun:sqlite";
import type { ConfirmationPayload,ConfirmationRequest,MemoryScope } from "../../modules/memory";
import type { Row } from "./memory";
import { schemaFeatures } from "./schema";

export function reinforcementEnabled(db: Database): boolean {
  return schemaFeatures(db)?.base===7;
}

export function confirmationCandidate(db: Database, owner: ConfirmationPayload & {scope:MemoryScope;projectId:string|null;groupId?:string|null}, requestNow: string): Row|null {
  const earliest=new Date(Date.parse(requestNow)-900_000).toISOString();
  const column=owner.scope==="ecosystem" ? "groupId" : "projectId";
  const ownerId=owner.scope==="ecosystem" ? owner.groupId??null : owner.projectId;
  return db.query(`SELECT m.* FROM memories m
    WHERE m.scope=? AND m.${column} IS ? AND m.topic_key IS NULL AND m.state='active'
      AND m.title=? AND m.content=? AND m.type=? AND m.pinned=?
      AND max(m.updated_at,coalesce((SELECT max(c.recordedAt) FROM confirmations c WHERE c.memoryId=m.id),m.updated_at)) BETWEEN ? AND ?
    ORDER BY max(m.updated_at,coalesce((SELECT max(c.recordedAt) FROM confirmations c WHERE c.memoryId=m.id),m.updated_at)) DESC,m.id ASC
    LIMIT 1`).get(owner.scope,ownerId,owner.title,owner.content,owner.type,Number(owner.pinned),earliest,requestNow) as Row|null;
}

export function confirmationRequest(db: Database, scope: MemoryScope, ownerId: string|null, requestKey: string): ConfirmationRequest|null {
  const column=scope==="ecosystem" ? "groupId" : "projectId";
  const row=db.query(`SELECT cr.memoryId,cr.requestKey,cr.payloadHash,cr.expectedVersion,cr.confirmationId,cr.response
    FROM confirmation_requests cr JOIN memories m ON m.id=cr.memoryId
    WHERE m.scope=? AND m.${column} IS ? AND cr.requestKey=?`).get(scope,ownerId,requestKey) as
      {memoryId:string;requestKey:string;payloadHash:string;expectedVersion:number|null;confirmationId:string;response:string}|null;
  return row ? {...row,response:JSON.parse(row.response) as ConfirmationRequest["response"]} : null;
}
