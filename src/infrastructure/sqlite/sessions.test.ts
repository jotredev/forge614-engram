/**
 * Comprueba el ciclo de vida de las sesiones runtime (de ejecución) y manuales: apertura, cierre,
 * inferencia por carpeta y el límite de compatibilidad entre niveles de esquema (schema, la versión
 * de la estructura de la base de datos).
 */
import { expect, test } from "bun:test";
import { startRuntimeSession, endRuntimeSession, getSession, inferredSessions, manualSession, sessionsEnabled, validateSelectedSession } from "./sessions";
import { createProject } from "./projects";
import { enableSessionLifecycle } from "./schema";
import { withDatabase } from "../__test-support__/fixtures";

// Comprueba que inferredSessions solo devuelva sesiones runtime abiertas ligadas a la carpeta consultada,
// que cerrar una sesión sea idempotente (repetirlo no cambia el resultado) y que una sesión cerrada
// ya no pueda validarse como abierta.
test("runtime bindings infer only open sessions in the selected directory", () => withDatabase(db => {
  enableSessionLifecycle(db); const p = createProject(db, "Owner");
  startRuntimeSession(db, p.projectId, "run", "/one");
  startRuntimeSession(db, p.projectId, "run", "/one");
  expect(inferredSessions(db, p.projectId, "/one", new Date().toISOString())).toEqual(["run"]);
  expect(inferredSessions(db, p.projectId, "/two", new Date().toISOString())).toEqual([]);
  const ended = endRuntimeSession(db, p.projectId, "run");
  expect(ended.endedAt).not.toBeNull();
  expect(endRuntimeSession(db, p.projectId, "run")).toEqual(ended);
  expect(getSession(db, p.projectId, "run")).toEqual(ended);
  expect(inferredSessions(db, p.projectId, "/one", new Date().toISOString())).toEqual([]);
  expect(() => validateSelectedSession(db, "run", "project", p.projectId, null, true)).toThrow(expect.objectContaining({ code: "SESSION_CLOSED" }));
}));

// Comprueba que la sesión manual sea única y estable por proyecto (se reutiliza en vez de crear otra) y
// que nunca pueda cerrarse con la función pensada para sesiones runtime.
test("manual session is reused per project and cannot be explicitly closed", () => withDatabase(db => {
  enableSessionLifecycle(db); const p = createProject(db, "Owner");
  const id = manualSession(db, p.projectId, "2026-01-01T00:00:00.000Z");
  expect(manualSession(db, p.projectId, "2026-02-01T00:00:00.000Z")).toBe(id);
  expect(() => endRuntimeSession(db, p.projectId, id)).toThrow(expect.objectContaining({ code: "SESSION_KIND" }));
}));

// Comprueba que en el nivel de esquema 7 las sesiones funcionan y que en el nivel 8 (que el
// esquema lee como la rama del ecosistema sobre la base 5, anterior a las sesiones) ya no
// cuentan como habilitadas y leer una sesión pide migrar (MIGRATION_REQUIRED).
test("schema 7 retains session capability without admitting future versions", () => withDatabase(db => {
  enableSessionLifecycle(db); db.exec("PRAGMA user_version=7");
  const p=createProject(db,"Seven");
  expect(sessionsEnabled(db)).toBe(true);
  expect(startRuntimeSession(db,p.projectId,"run").sessionId).toBe("run");
  db.exec("PRAGMA user_version=8");
  expect(sessionsEnabled(db)).toBe(false);
  expect(()=>getSession(db,p.projectId,"run")).toThrow(expect.objectContaining({code:"MIGRATION_REQUIRED"}));
}));
