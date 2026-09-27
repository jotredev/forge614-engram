/** Prueba el tablero (board) de un grupo del ecosistema: los límites y reglas al guardar recuerdos
 * de alcance "ecosystem" (tipo permitido, proyectos afectados, cupo, nota de estado), y cómo se fija
 * el proyecto fuente de un grupo y se degrada (demote) un recuerdo de vuelta a un proyecto. */
import type { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { withDatabase } from "../__test-support__/fixtures";
import { demoteMemory, groupSource, setGroupSource } from "./board";
import { bindProjectToGroup, createGroup, identityEvents } from "./ecosystem-groups";
import { get, history } from "./memory";
import { createProject } from "./projects";
import { enableEcosystem, enableIntelligence, enableProjectBindings } from "./schema";
import { getVersion } from "./search";
import { archive, moveMemoryToGroup, save } from "./writes";

/** Los identificadores del escenario que arma `board`: el grupo y sus tres proyectos miembros
 * (ai, engram, shell), más un proyecto suelto que no pertenece al grupo. */
type Board = { group: string; ai: string; engram: string; shell: string; loose: string };
/**
 * Prepara una base con memoria inteligente habilitada, cuatro proyectos y un grupo del ecosistema
 * que agrupa a tres de ellos, y ejecuta `run` con ese escenario ya armado. Lo usa cada prueba que
 * necesita un grupo con miembros para probar el tablero.
 * @param run función de prueba que recibe la base y los identificadores del escenario.
 */
function board(run: (db: Database, x: Board) => void): void {
  withDatabase(db => {
    enableIntelligence(db);
    const ai = createProject(db, "forge614-ai").projectId, engram = createProject(db, "forge614-engram").projectId;
    const shell = createProject(db, "forge614-shell").projectId, loose = createProject(db, "suelto").projectId;
    const group = createGroup(db, "forge614").id;
    for (const project of [ai, engram, shell]) bindProjectToGroup(db, project, group, "command");
    run(db, { group, ai, engram, shell, loose });
  });
}
/** Arma los datos de un recuerdo de tipo "decision" (decisión) válido para el tablero de `group`,
 * con dos proyectos afectados; `extra` sobrescribe o añade campos para provocar casos de error. */
const rule = (group: string, extra: Record<string, unknown> = {}) => ({ scope: "ecosystem" as const, projectId: null, groupId: group,
  title: "Contrato de API", content: "Los nodos hablan JSON versionado.", type: "decision" as const, topicKey: "api",
  affects: ["forge614-engram", "forge614-shell"], ...extra });
/** Arma los datos de la nota de estado (tipo "fact", con el tema fijo "ecosystem/estado-actual")
 * del grupo `group`; `extra` sobrescribe o añade campos para provocar casos de error. */
const status = (group: string, extra: Record<string, unknown> = {}) => ({ scope: "ecosystem" as const, projectId: null, groupId: group,
  title: "Estado actual", content: "Frente: Engram 1.7.0; paso: T4.", type: "fact" as const, topicKey: "ecosystem/estado-actual", ...extra });
/** Ayuda a comprobar que un error lanzado tenga el código de MemoryError indicado. */
const code = (value: string) => expect.objectContaining({ code: value });

// Por debajo del nivel de esquema 11, el tablero se comporta como en la versión 1.6.0 (sin límites
// nuevos) y las operaciones nuevas (fijar fuente, degradar) exigen memoria inteligente.
test("below level 11 the board keeps the 1.6.0 behavior and the new operations need intelligence", () => withDatabase(db => {
  enableProjectBindings(db); enableEcosystem(db);
  const project = createProject(db, "tienda-web").projectId, group = createGroup(db, "tienda").id;
  bindProjectToGroup(db, project, group, "command");
  const saved = save(db, { scope: "ecosystem", projectId: null, groupId: group, title: "Nota", content: "libre", type: "fact", fromProjectId: project });
  expect(saved.type).toBe("fact");
  expect(() => setGroupSource(db, group, project)).toThrow(code("INTELLIGENCE_REQUIRED"));
  expect(() => demoteMemory(db, project, saved.id)).toThrow(code("INTELLIGENCE_REQUIRED"));
}));

// Un recuerdo de tablero exige un tipo permitido y al menos dos proyectos afectados (affects) que
// existan y pertenezcan al grupo; guardar una nueva versión sin repetir "affects" no los borra.
test("a board memory needs an allowed type and at least two affected projects of the group", () => board((db, { group }) => {
  expect(() => save(db, rule(group, { type: "fact", affects: undefined }))).toThrow(code("ECOSYSTEM_TYPE_NOT_ALLOWED"));
  expect(() => save(db, rule(group, { affects: undefined }))).toThrow(code("ECOSYSTEM_AFFECTS_REQUIRED"));
  expect(() => save(db, rule(group, { affects: ["forge614-engram"] }))).toThrow(code("ECOSYSTEM_AFFECTS_REQUIRED"));
  expect(() => save(db, rule(group, { affects: ["forge614-engram", "suelto"] }))).toThrow(code("ECOSYSTEM_AFFECTS_UNKNOWN"));
  const saved = save(db, rule(group, { affects: [" forge614-shell", "forge614-engram"] }));
  expect(getVersion(db, { groupId: group }, saved.id)?.meta?.affects).toEqual(["forge614-engram", "forge614-shell"]);
  // Una versión nueva puede omitir "affects": los ya guardados se conservan y siguen contando.
  expect(save(db, rule(group, { content: "v2", expectedVersion: 1, affects: undefined })).version).toBe(2);
}));

// El tablero tiene un cupo de 40 recuerdos activos (tengan tema o no); actualizar uno existente,
// archivarlo o guardar la nota de estado del grupo no gastan cupo.
test("the board holds at most 40 active memories, with or without a topic; updates, archived ones and the status note do not count", () => board((db, { group, ai }) => {
  const ids = Array.from({ length: 40 }, (_, i) => save(db, rule(group, { title: `Regla ${i}`, content: `Contenido ${i}`, topicKey: i === 0 ? undefined : `regla/${i}` })).id);
  let error: unknown;
  try { save(db, rule(group, { title: "Regla 40", content: "otra", topicKey: "regla/40" })); } catch (caught) { error = caught; }
  expect(error).toMatchObject({ code: "ECOSYSTEM_BOARD_FULL" });
  expect((error as Error).message).toContain("Regla 0");
  expect(save(db, rule(group, { title: "Regla 1", content: "cambiada", topicKey: "regla/1", expectedVersion: 1 })).version).toBe(2);
  setGroupSource(db, group, ai);
  expect(save(db, status(group, { fromProjectId: ai })).pinned).toBe(true);
  archive(db, { groupId: group }, ids[1]!);
  expect(save(db, rule(group, { title: "Regla 40", content: "otra", topicKey: "regla/40" })).scope).toBe("ecosystem");
}));

// Solo el proyecto fuente del grupo puede escribir su nota de estado; esa nota siempre queda fijada
// (pinned) y su contenido no puede pasar de 600 caracteres, contando cada carácter (no bytes).
test("only the group's source project writes the status note: pinned, up to 600 characters, facts allowed", () => board((db, { group, ai, engram }) => {
  expect(() => save(db, status(group, { fromProjectId: ai }))).toThrow(code("ECOSYSTEM_STATUS_FORBIDDEN"));
  expect(setGroupSource(db, group, ai)).toEqual({ groupId: group, projectId: ai, setAt: expect.any(String) });
  expect(() => save(db, status(group, { fromProjectId: engram }))).toThrow(code("ECOSYSTEM_STATUS_FORBIDDEN"));
  expect(() => save(db, status(group))).toThrow(code("ECOSYSTEM_STATUS_FORBIDDEN"));
  expect(() => save(db, status(group, { fromProjectId: ai, type: "preference" }))).toThrow(code("ECOSYSTEM_TYPE_NOT_ALLOWED"));
  expect(() => save(db, status(group, { fromProjectId: ai, content: "x".repeat(601) }))).toThrow(code("ECOSYSTEM_STATUS_TOO_LONG"));
  const saved = save(db, status(group, { fromProjectId: ai, content: "é".repeat(600), requestKey: "estado-1" }));
  expect(saved).toMatchObject({ scope: "ecosystem", topicKey: "ecosystem/estado-actual", type: "fact", pinned: true });
  // Repetir la misma petición (mismo requestKey) devuelve el mismo recuerdo: "pinned" se fuerza antes
  // de calcular la huella (fingerprint) que identifica la petición.
  expect(save(db, status(group, { fromProjectId: ai, content: "é".repeat(600), requestKey: "estado-1" })).id).toBe(saved.id);
  expect(groupSource(db, group)?.projectId).toBe(ai);
}));

// La fuente del grupo debe ser un proyecto miembro; fijarla de nuevo reemplaza a la anterior y cada
// cambio queda registrado como evento de identidad.
test("the group source must be a member of the group; setting it again replaces it and is recorded", () => board((db, { group, ai, engram, loose }) => {
  expect(() => setGroupSource(db, group, loose)).toThrow(code("GROUP_REQUIRED"));
  expect(() => setGroupSource(db, group, crypto.randomUUID())).toThrow(code("PROJECT_NOT_FOUND"));
  expect(() => setGroupSource(db, crypto.randomUUID(), ai)).toThrow(code("GROUP_NOT_FOUND"));
  expect(groupSource(db, group)).toBeNull();
  setGroupSource(db, group, ai);
  expect(setGroupSource(db, group, engram).projectId).toBe(engram);
  expect(groupSource(db, group)?.projectId).toBe(engram);
  expect(identityEvents(db).filter(event => event.action === "GROUP_SOURCE_SET")).toHaveLength(2);
}));

// Degradar (demote) un recuerdo del tablero lo devuelve a un proyecto miembro conservando su
// identificador, su historial de versiones y sus metadatos, y se rechaza en los casos de conflicto.
test("demoting returns a board memory to a member project and keeps its id, history and metadata", () => board((db, { group, engram, loose }) => {
  const first = save(db, rule(group));
  save(db, rule(group, { content: "v2", expectedVersion: 1 }));
  expect(() => demoteMemory(db, loose, first.id)).toThrow(code("GROUP_REQUIRED"));
  const demoted = demoteMemory(db, engram, first.id);
  expect(demoted.from).toEqual({ scope: "ecosystem", groupId: group });
  expect(demoted.to).toEqual({ scope: "project", projectId: engram });
  expect(demoted.memory).toMatchObject({ id: first.id, scope: "project", projectId: engram, version: 3, content: "v2", state: "active" });
  expect(history(db, engram, first.id).map(version => [version.version, version.scope])).toEqual([[1, "ecosystem"], [2, "ecosystem"], [3, "project"]]);
  expect(get(db, { groupId: group }, first.id)).toBeNull();
  expect(getVersion(db, engram, first.id)?.meta?.affects).toEqual(["forge614-engram", "forge614-shell"]);
  expect(identityEvents(db).some(event => event.action === "MEMORY_DEMOTED" && event.memoryId === first.id)).toBe(true);
  expect(() => demoteMemory(db, engram, first.id)).toThrow(code("NOT_FOUND"));
  const again = save(db, rule(group, { title: "Otro contrato", content: "otro" }));
  expect(() => demoteMemory(db, engram, again.id)).toThrow(code("TOPIC_CONFLICT"));
}));

// Mover un recuerdo de proyecto hacia el tablero de un grupo obedece las mismas reglas de tipo,
// proyectos afectados y nota de estado que guardarlo directamente en el tablero.
test("moving a memory onto the board obeys the same rules at level 11", () => board((db, { group, engram }) => {
  const fact = save(db, { scope: "project", projectId: engram, title: "Hecho", content: "algo", type: "fact" });
  expect(() => moveMemoryToGroup(db, engram, fact.id, group)).toThrow(code("ECOSYSTEM_TYPE_NOT_ALLOWED"));
  const decision = { scope: "project" as const, projectId: engram, title: "Decisión", content: "usar JSON", type: "decision" as const, topicKey: "d" };
  const bare = save(db, decision);
  expect(() => moveMemoryToGroup(db, engram, bare.id, group)).toThrow(code("ECOSYSTEM_AFFECTS_REQUIRED"));
  save(db, { ...decision, expectedVersion: 1, affects: ["forge614-engram", "forge614-shell"] });
  expect(moveMemoryToGroup(db, engram, bare.id, group).memory.scope).toBe("ecosystem");
  const note = save(db, { scope: "project", projectId: engram, title: "Estado", content: "x", type: "fact", topicKey: "ecosystem/estado-actual" });
  expect(() => moveMemoryToGroup(db, engram, note.id, group)).toThrow(code("ECOSYSTEM_STATUS_FORBIDDEN"));
}));
