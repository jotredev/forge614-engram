/** Prueba cuándo una memoria repetida cuenta como candidata a confirmación y cómo se resuelven las
 * solicitudes de confirmación por su clave. */
import { expect, test } from "bun:test";
import { createProject } from "./projects";
import { enableSearchReinforcement } from "./schema";
import { confirmationCandidate, confirmationRequest, reinforcementEnabled } from "./confirmations";
import { save } from "./writes";
import { withDatabase } from "../__test-support__/fixtures";

// El refuerzo por confirmación solo debe estar disponible mientras la base está exactamente en el
// nivel de esquema base 7.
test("reinforcement capability admits schema 7 only", () => withDatabase(db => {
  expect(reinforcementEnabled(db)).toBe(false);
  enableSearchReinforcement(db);
  expect(reinforcementEnabled(db)).toBe(true);
  db.exec("PRAGMA user_version=8");
  expect(reinforcementEnabled(db)).toBe(false);
}));

// La búsqueda de candidata debe respetar la ventana de tiempo acotada y, entre varias que empatan,
// elegir siempre la misma de forma determinista (menor id).
test("candidate selection uses bounded last-seen time and deterministic tie breaking", () => withDatabase(db => {
  const project = createProject(db,"Owner");
  const payload = {projectId:project.projectId,title:"Queue",content:"Use jobs",type:"decision" as const};
  const first=save(db,payload), second=save(db,payload);
  enableSearchReinforcement(db);
  db.query("UPDATE memories SET updated_at=? WHERE id IN (?,?)").run("2026-09-17T11:45:00.000Z",first.id,second.id);
  expect(confirmationCandidate(db,{scope:"project",projectId:project.projectId,title:"Queue",content:"Use jobs",type:"decision",topicKey:null,pinned:false},"2026-09-17T12:00:00.000Z")?.id)
    .toBe([first.id,second.id].sort()[0]);
  db.query("UPDATE memories SET updated_at=? WHERE id=?").run("2026-09-17T12:00:00.001Z",first.id);
  expect(confirmationCandidate(db,{scope:"project",projectId:project.projectId,title:"Queue",content:"Use jobs",type:"decision",topicKey:null,pinned:false},"2026-09-17T12:00:00.000Z")?.id)
    .toBe(second.id);
}));

// La misma clave de solicitud (requestKey) usada por dos dueños distintos no debe cruzarse: cada
// solicitud se resuelve solo dentro del espacio de su propio dueño.
test("confirmation requests are resolved through their memory owner namespace", () => withDatabase(db => {
  const one=createProject(db,"One"),two=createProject(db,"Two");enableSearchReinforcement(db);
  const first=save(db,{projectId:one.projectId,title:"Queue",content:"Use jobs",type:"decision"});
  save(db,{projectId:one.projectId,title:"Queue",content:"Use jobs",type:"decision",requestKey:"same"});
  expect(confirmationRequest(db,one.projectId===null?"shared":"project",one.projectId,"same")?.response.memory).toEqual(first);
  expect(confirmationRequest(db,"project",two.projectId,"same")).toBeNull();
}));
