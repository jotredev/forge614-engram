/** Comprueba la validación del identificador de sesión, el armado del resumen estructurado y el aviso sobre sesión previa, sesiones en paralelo y avisos de nube. */
import { expect, test } from "bun:test";
import { sessionIdentity, sessionNotice, summaryContent, type CloudNotice } from "./rules";
import type { ParallelSession, PreviousSession } from "./types";

// El largo se cuenta en caracteres Unicode (200 emojis pasan, 201 no); vacío, espacio exterior,
// salto de línea y un carácter de formato invisible (u200b) deben rechazarse.
test("session IDs count Unicode characters and reject blank, control and exterior whitespace", () => {
  const boundary = "😀".repeat(200);
  expect(sessionIdentity(boundary)).toBe(boundary);
  for (const value of [boundary + "a", "", " bad", "bad ", "a\n", "a\u200b", null]) {
    expect(() => sessionIdentity(value)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  }
});

const fields = {goal:"g",instructions:"i",discoveries:"d",accomplishments:"a",nextSteps:"n",files:["x","y"]};
// El orden de los seis bloques es fijo y cada archivo de `files` va en su propia línea.
test("summary rendering preserves structured field ordering and file lines", () => {
  expect(summaryContent(fields)).toBe("Goal:\ng\n\nInstructions:\ni\n\nDiscoveries:\nd\n\nAccomplishments:\na\n\nNext steps:\nn\n\nFiles:\nx\ny");
});
// goal es el único campo que no puede quedar en blanco; cualquier campo de texto con byte nulo, o
// un elemento de files que no sea texto, debe rechazarse.
test("summary validation rejects a blank goal, NUL text and nontext files", () => {
  for (const value of [{...fields,goal:" "},{...fields,instructions:"bad\0"},{...fields,files:[42]}]) {
    expect(() => summaryContent(value as typeof fields)).toThrow(expect.objectContaining({code:"INVALID_INPUT"}));
  }
});

const previousWithSummary:PreviousSession = {sessionId:"first",interruptedAt:"2026-01-01T00:00:00.000Z",summary:{id:"m1",version:1} as PreviousSession["summary"]};
const previousNoSummary:PreviousSession = {sessionId:"first",interruptedAt:"2026-01-01T00:00:00.000Z",summary:null};
const oneParallel:ParallelSession[] = [{sessionId:"second",lastActivityAt:"2026-01-01T00:10:00.000Z"}];
const manyParallel:ParallelSession[] = [{sessionId:"second",lastActivityAt:"2026-01-01T00:10:00.000Z"},{sessionId:"third",lastActivityAt:"2026-01-01T00:11:00.000Z"}];

// El aviso menciona la sesión previa dejada abierta, distinguiendo si guardó resumen o no.
test("sessionNotice states the previous session left open, whether or not it saved a summary", () => {
  expect(sessionNotice(previousWithSummary,null)).toBe("Session first was left open; its last activity was at 2026-01-01T00:00:00.000Z; its summary is available.");
  expect(sessionNotice(previousNoSummary,null)).toBe("Session first was left open; its last activity was at 2026-01-01T00:00:00.000Z; it saved no summary.");
});
// Con una sola sesión en paralelo la frase es singular; con varias, plural y lista los ids.
test("sessionNotice states which sessions are open now, singular and plural", () => {
  expect(sessionNotice(null,oneParallel)).toBe("Another session is open now: second.");
  expect(sessionNotice(null,manyParallel)).toBe("Other sessions are open now: second, third.");
});
// Cuando hay sesión previa y sesiones en paralelo a la vez, la frase de la previa va primero.
test("sessionNotice joins the previous sentence and the parallel sentence, previous first", () => {
  expect(sessionNotice(previousWithSummary,oneParallel)).toBe("Session first was left open; its last activity was at 2026-01-01T00:00:00.000Z; its summary is available. Another session is open now: second.");
});
// Sin sesión previa ni sesiones en paralelo (incluido un arreglo vacío), no hay nada que avisar.
test("sessionNotice is null with neither previous nor parallel", () => {
  expect(sessionNotice(null,null)).toBeNull();
  expect(sessionNotice(undefined,undefined)).toBeNull();
  expect(sessionNotice(null,[])).toBeNull();
});

const conflictNotice:CloudNotice = {kind:"conflict",detail:"Cloud sync: 1 memory had a conflicting change from another Mac; the most recent version is active and the other one is in its history."};
const staleNotice:CloudNotice = {kind:"stale-outbox",detail:"Cloud sync: 3 local changes have been waiting to upload for more than 24 h (oldest from 2026-01-01T00:00:00.000Z)."};

// Con un solo aviso de nube (conflicto), su texto se agrega tal cual, sin ningún otro dato de sesión.
test("sessionNotice appends a lone conflict cloud notice unchanged", () => {
  expect(sessionNotice(null,null,[conflictNotice])).toBe(conflictNotice.detail);
});
// Con un solo aviso de nube (cola vieja), igual: su texto se agrega tal cual.
test("sessionNotice appends a lone stale-outbox cloud notice unchanged", () => {
  expect(sessionNotice(null,null,[staleNotice])).toBe(staleNotice.detail);
});
// Con los dos avisos de nube juntos, se agregan en el mismo orden en que llegan, separados por un espacio.
test("sessionNotice appends both cloud notices together, in the order given", () => {
  expect(sessionNotice(null,null,[conflictNotice,staleNotice])).toBe(`${conflictNotice.detail} ${staleNotice.detail}`);
});
// Sin avisos de nube (null, undefined o arreglo vacío), el resultado es idéntico al de antes de D4/D11: no cambia nada de lo existente.
test("sessionNotice is unchanged from before when there are no cloud notices", () => {
  expect(sessionNotice(previousWithSummary,oneParallel,null)).toBe(sessionNotice(previousWithSummary,oneParallel));
  expect(sessionNotice(previousWithSummary,oneParallel,undefined)).toBe(sessionNotice(previousWithSummary,oneParallel));
  expect(sessionNotice(previousWithSummary,oneParallel,[])).toBe(sessionNotice(previousWithSummary,oneParallel));
});
// Los avisos de nube van después de la sesión previa y de las sesiones en paralelo, en ese orden, sin tocar esas partes.
test("sessionNotice puts cloud notices last, after the previous-session and parallel-session parts", () => {
  expect(sessionNotice(previousWithSummary,manyParallel,[conflictNotice])).toBe(
    `Session first was left open; its last activity was at 2026-01-01T00:00:00.000Z; its summary is available. Other sessions are open now: second, third. ${conflictNotice.detail}`);
});
