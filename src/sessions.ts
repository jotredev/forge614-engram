import type { Database } from "bun:sqlite";
import { MemoryError } from "./domain";
import type { Session, SummaryFields } from "./session-types";

export function sessionIdentity(value: unknown): string {
  const length = typeof value === "string" ? Array.from(value).length : 0;
  if (typeof value !== "string" || length < 1 || length > 200 ||
      value.trim() !== value || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new MemoryError("INVALID_INPUT", "sessionId debe tener entre 1 y 200 caracteres, sin controles ni espacios exteriores.");
  }
  return value;
}

export function summaryContent(fields: SummaryFields): string {
  if (!fields || typeof fields !== "object") throw new MemoryError("INVALID_INPUT", "El resumen debe ser estructurado.");
  const goal = textField(fields.goal,"goal",true);
  const instructions = textField(fields.instructions,"instructions");
  const discoveries = textField(fields.discoveries,"discoveries");
  const accomplishments = textField(fields.accomplishments,"accomplishments");
  const nextSteps = textField(fields.nextSteps,"nextSteps");
  if (!Array.isArray(fields.files) || fields.files.some(file => typeof file !== "string")) {
    throw new MemoryError("INVALID_INPUT", "files debe ser un arreglo de textos.");
  }
  return [`Goal:\n${goal}`,`Instructions:\n${instructions}`,`Discoveries:\n${discoveries}`,
    `Accomplishments:\n${accomplishments}`,`Next steps:\n${nextSteps}`,
    `Files:\n${fields.files.join("\n")}`].join("\n\n");
}

function textField(value: unknown, field: string, nonblank = false): string {
  if (typeof value !== "string" || value.includes("\0") || (nonblank && !value.trim())) {
    throw new MemoryError("INVALID_INPUT", `${field} debe ser texto${nonblank ? " no vacío" : ""}.`);
  }
  return value;
}

export function sessionRow(db: Database, sessionId: string): Session | null {
  return db.query("SELECT sessionId,projectId,kind,startedAt,endedAt FROM sessions WHERE sessionId=?")
    .get(sessionId) as Session | null;
}

// These helpers deliberately do not open or commit transactions. Their caller owns
// the transaction so project creation, local binding, and lifecycle changes compose.
export function startRuntimeSession(db: Database, projectId: string, sessionId: string, runtimeDirectory?: string): Session {
  const existing = sessionRow(db, sessionId);
  if (existing) {
    if (existing.projectId !== projectId || existing.kind !== "runtime" || existing.endedAt !== null) {
      throw new MemoryError("SESSION_CONFLICT", "El identificador de sesión no está disponible.");
    }
  } else {
    const project = db.query("SELECT 1 FROM projects WHERE projectId=?").get(projectId);
    if (!project) throw new MemoryError("PROJECT_NOT_FOUND", "Proyecto no encontrado en esta base.");
    db.query("INSERT INTO sessions(sessionId,projectId,kind,startedAt,endedAt) VALUES(?,?,'runtime',?,NULL)")
      .run(sessionId, projectId, new Date().toISOString());
  }
  if (runtimeDirectory !== undefined) {
    db.query("INSERT OR IGNORE INTO local_session_bindings(sessionId,directory) VALUES(?,?)")
      .run(sessionId, runtimeDirectory);
  }
  return sessionRow(db, sessionId)!;
}

export function endRuntimeSession(db: Database, projectId: string, sessionId: string): Session {
  const existing = sessionRow(db, sessionId);
  if (!existing || existing.projectId !== projectId) {
    throw new MemoryError("SESSION_NOT_FOUND", "Sesión no encontrada para este proyecto.");
  }
  if (existing.kind !== "runtime") throw new MemoryError("SESSION_KIND", "Una sesión manual no puede cerrarse.");
  if (existing.endedAt === null) {
    db.query("UPDATE sessions SET endedAt=? WHERE sessionId=? AND endedAt IS NULL")
      .run(new Date().toISOString(), sessionId);
  }
  return sessionRow(db, sessionId)!;
}
