/** Prueba touchSession, previousInterrupted y parallelSessions: cómo se clasifica una sesión de
 * ejecución (runtime) como abierta en paralelo o como dejada abierta, según el tiempo transcurrido. */
import { expect, setSystemTime, test } from "bun:test";
import { withDatabase } from "../__test-support__/fixtures";
import { createProject } from "./projects";
import { inferredSessions, manualSession } from "./sessions";
import { enableIntelligence, enableSearchReinforcement } from "./schema";
import { endSession, saveSessionSummary, saveWithSession, startSession } from "./writes";
import { parallelSessions, previousInterrupted, touchSession } from "./activity";

// Por debajo del nivel de inteligencia todo esto se apaga sin errores, y la inferencia por antigüedad
// (ventana de siete días) sigue funcionando igual que antes de ese nivel.
test("below intelligence level, touchSession is inert, previousInterrupted/parallelSessions are empty and inference keeps the seven-day window", () => withDatabase(db => {
  enableSearchReinforcement(db);
  const p = createProject(db, "Pre11");
  startSession(db, p.projectId, "old", "/dir");
  expect(() => touchSession(db, "old", new Date().toISOString())).not.toThrow();
  expect(previousInterrupted(db, p.projectId)).toBeNull();
  expect(parallelSessions(db, p.projectId, "old")).toEqual([]);
  db.query("UPDATE sessions SET startedAt=? WHERE sessionId='old'").run(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString());
  expect(inferredSessions(db, p.projectId, "/dir", new Date().toISOString())).toEqual(["old"]);
}));

// Al iniciar una sesión de ejecución nueva no se marca ninguna otra como interrumpida: esa marca
// automática al arrancar se quitó en la versión 1.7.1.
test("starting a new runtime session marks nobody: other open sessions keep interruptedAt untouched", () => withDatabase(db => {
  enableIntelligence(db);
  const p = createProject(db, "P");
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    startSession(db, p.projectId, "A", "/a");
    setSystemTime(new Date("2026-01-01T00:10:00.000Z"));
    startSession(db, p.projectId, "B", "/b");
    expect(db.query("SELECT sessionId,interruptedAt FROM session_activity ORDER BY sessionId").all())
      .toEqual([{ sessionId: "A", interruptedAt: null }, { sessionId: "B", interruptedAt: null }]);
    // Ambas sesiones son recientes: todavía nadie cuenta como dejada abierta, y A está abierta en
    // paralelo con B.
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:10:00.000Z")).toBeNull();
    expect(parallelSessions(db, p.projectId, "B", "2026-01-01T00:10:00.000Z"))
      .toEqual([{ sessionId: "A", lastActivityAt: "2026-01-01T00:00:00.000Z" }]);
    startSession(db, p.projectId, "B", "/b"); // repetir la llamada: tampoco marca a nadie
    expect(db.query("SELECT interruptedAt FROM session_activity WHERE sessionId='A'").get()).toEqual({ interruptedAt: null });
  } finally { setSystemTime(); }
}));

// Verifica el límite exacto: justo en PARALLEL_MINUTES la sesión todavía cuenta como paralela, y un
// segundo después ya cuenta como dejada abierta.
test("a session left open crosses from parallel to previous exactly at PARALLEL_MINUTES", () => withDatabase(db => {
  enableIntelligence(db);
  const p = createProject(db, "P");
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    startSession(db, p.projectId, "A", "/a");
    startSession(db, p.projectId, "B", "/b");
    expect(parallelSessions(db, p.projectId, "B", "2026-01-01T00:29:59.000Z"))
      .toEqual([{ sessionId: "A", lastActivityAt: "2026-01-01T00:00:00.000Z" }]);
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:29:59.000Z")).toBeNull();
    // Justo en el límite de 30 minutos, A sigue en paralelo (>= umbral), todavía no es previa.
    expect(parallelSessions(db, p.projectId, "B", "2026-01-01T00:30:00.000Z"))
      .toEqual([{ sessionId: "A", lastActivityAt: "2026-01-01T00:00:00.000Z" }]);
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:30:00.000Z")).toBeNull();
    // Un segundo después, A pasa a ser previa (su última actividad ya es estrictamente anterior al
    // umbral) y deja de contar como paralela.
    expect(parallelSessions(db, p.projectId, "B", "2026-01-01T00:30:01.000Z")).toEqual([]);
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:30:01.000Z"))
      .toEqual({ sessionId: "A", interruptedAt: "2026-01-01T00:00:00.000Z", summary: null });
  } finally { setSystemTime(); }
}));

// Una marca `interruptedAt` heredada de una base anterior a 1.7.1 no debe alterar la clasificación:
// solo importa el tiempo transcurrido desde la última actividad real.
test("a legacy interruptedAt mark is ignored entirely: a session active 5 minutes ago is parallel, not previous", () => withDatabase(db => {
  enableIntelligence(db);
  const p = createProject(db, "P");
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    startSession(db, p.projectId, "A", "/a");
    setSystemTime(new Date("2026-01-01T00:05:00.000Z"));
    // Simula datos heredados de una base anterior a 1.7.1: una marca interruptedAt antigua junto a
    // actividad real reciente. La clasificación se basa solo en el tiempo transcurrido, así que la
    // marca se ignora.
    db.query("UPDATE session_activity SET lastActivityAt=?,interruptedAt=? WHERE sessionId='A'")
      .run("2026-01-01T00:05:00.000Z", "2026-01-01T00:00:00.000Z");
    startSession(db, p.projectId, "B", "/b");
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:05:00.000Z")).toBeNull();
    expect(parallelSessions(db, p.projectId, "B", "2026-01-01T00:05:00.000Z"))
      .toEqual([{ sessionId: "A", lastActivityAt: "2026-01-01T00:05:00.000Z" }]);
  } finally { setSystemTime(); }
}));

// Comprueba el límite de 3 resultados, el orden de más reciente a más antigua, y que se excluyen las
// sesiones terminadas, las manuales, las de otro proyecto y la propia.
test("parallelSessions caps at 3, newest first, and excludes ended, manual, other-project and self sessions", () => withDatabase(db => {
  enableIntelligence(db);
  const p = createProject(db, "P"), other = createProject(db, "Other");
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    startSession(db, p.projectId, "Z", "/z");
    endSession(db, p.projectId, "Z");
    manualSession(db, p.projectId, new Date().toISOString());
    startSession(db, other.projectId, "O", "/o");
    startSession(db, p.projectId, "A", "/a");
    setSystemTime(new Date("2026-01-01T00:01:00.000Z"));
    startSession(db, p.projectId, "B", "/b");
    setSystemTime(new Date("2026-01-01T00:02:00.000Z"));
    startSession(db, p.projectId, "C", "/c");
    setSystemTime(new Date("2026-01-01T00:03:00.000Z"));
    startSession(db, p.projectId, "D", "/d");
    expect(parallelSessions(db, p.projectId, "D", "2026-01-01T00:03:00.000Z")).toEqual([
      { sessionId: "C", lastActivityAt: "2026-01-01T00:02:00.000Z" },
      { sessionId: "B", lastActivityAt: "2026-01-01T00:01:00.000Z" },
      { sessionId: "A", lastActivityAt: "2026-01-01T00:00:00.000Z" },
    ]);
  } finally { setSystemTime(); }
}));

// Cualquier actividad nueva (incluso guardar una memoria) retrasa el momento en que la sesión cuenta
// como dejada abierta, y terminarla la retira del todo de esa clasificación.
test("a session left open past PARALLEL_MINUTES is reported by previousInterrupted, and any activity postpones it", () => withDatabase(db => {
  enableIntelligence(db);
  const p = createProject(db, "P");
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    startSession(db, p.projectId, "S", "/s");
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:29:00.000Z")).toBeNull();
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:30:01.000Z"))
      .toEqual({ sessionId: "S", interruptedAt: "2026-01-01T00:00:00.000Z", summary: null });
    setSystemTime(new Date("2026-01-01T00:10:00.000Z"));
    saveWithSession(db, { projectId: p.projectId, title: "Note", content: "Body", type: "fact" }, { sessionId: "S" });
    // La última actividad de S se acaba de mover a 00:10, así que no vuelve a contar como dejada
    // abierta hasta pasadas las 00:40.
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:30:01.000Z")).toBeNull();
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:40:01.000Z"))
      .toEqual({ sessionId: "S", interruptedAt: "2026-01-01T00:10:00.000Z", summary: null });
    setSystemTime(new Date("2026-01-01T00:41:00.000Z"));
    const ended = endSession(db, p.projectId, "S");
    expect(ended.endedAt).not.toBeNull();
    expect(db.query("SELECT interruptedAt FROM session_activity WHERE sessionId='S'").get()).toEqual({ interruptedAt: null });
    expect(previousInterrupted(db, p.projectId, "2026-06-01T00:00:00.000Z")?.sessionId).not.toBe("S");
  } finally { setSystemTime(); }
}));

// La inferencia de sesiones activas descarta las marcadas manualmente (dato heredado) y las inactivas
// por más de INACTIVITY_HOURS, sin afectar a las sesiones manuales.
test("inference at level 11 excludes marked and stale sessions; manual sessions stay untouched", () => withDatabase(db => {
  enableIntelligence(db);
  const marked = createProject(db, "Marked"), idle = createProject(db, "Idle");
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    startSession(db, marked.projectId, "old", "/dir");
    setSystemTime(new Date("2026-01-01T01:00:00.000Z"));
    startSession(db, marked.projectId, "new", "/dir");
    // Ya no se marca a nadie al iniciar sesión (1.7.1); se simula aquí, directamente, una marca
    // heredada de una base anterior, para mostrar que la inferencia sigue descartando una sesión
    // marcada explícitamente.
    db.query("UPDATE session_activity SET interruptedAt=? WHERE sessionId='old'").run(new Date().toISOString());
    expect(inferredSessions(db, marked.projectId, "/dir", "2026-01-01T01:00:00.000Z")).toEqual(["new"]);
    startSession(db, idle.projectId, "fresh", "/dir");
    expect(inferredSessions(db, idle.projectId, "/dir", "2026-01-01T06:59:00.000Z")).toEqual(["fresh"]);
    expect(inferredSessions(db, idle.projectId, "/dir", "2026-01-01T07:01:00.000Z")).toEqual([]);
    manualSession(db, marked.projectId, new Date().toISOString());
    expect(db.query("SELECT count(*) AS n FROM session_activity").get()).toEqual({ n: 3 });
  } finally { setSystemTime(); }
}));

// Si la sesión dejada abierta guardó un resumen, ese resumen debe viajar junto con la clasificación.
test("previousInterrupted returns the last summary of the session left open", () => withDatabase(db => {
  enableIntelligence(db);
  const p = createProject(db, "P");
  setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  try {
    startSession(db, p.projectId, "A", "/a");
    const summary = saveSessionSummary(db, p.projectId, "A",
      { goal: "g", instructions: "", discoveries: "", accomplishments: "", nextSteps: "", files: [] }, { requestKey: "r" });
    expect(previousInterrupted(db, p.projectId, "2026-01-01T00:30:01.000Z"))
      .toEqual({ sessionId: "A", interruptedAt: "2026-01-01T00:00:00.000Z", summary: summary.memory });
  } finally { setSystemTime(); }
}));
