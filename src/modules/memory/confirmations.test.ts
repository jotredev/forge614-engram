/** Comprueba que la comparación de confirmación exacta tenga en cuenta cada campo normalizado del payload. */
import { expect, test } from "bun:test";
import { sameConfirmationPayload } from "./confirmations";
import type { MemoryVersion } from "./types";

const memory: MemoryVersion = {
  id: "memory", projectId: "project", scope: "project", topicKey: "topic",
  title: "Queue", content: "Use jobs", type: "decision", pinned: true, version: 2,
  createdAt: "2026-09-17T11:00:00.000Z", updatedAt: "2026-09-17T12:00:00.000Z",
};

// Cambiar cualquiera de los cinco campos comparados (título, contenido, tipo, topicKey o pinned) debe
// romper la igualdad; solo el payload idéntico en los cinco campos cuenta como el mismo reintento.
test("exact confirmation comparison includes every normalized payload field", () => {
  const exact = { title:"Queue",content:"Use jobs",type:"decision" as const,topicKey:"topic",pinned:true };
  expect(sameConfirmationPayload(memory, exact)).toBe(true);
  expect(sameConfirmationPayload(memory, { ...exact,title:"Other" })).toBe(false);
  expect(sameConfirmationPayload(memory, { ...exact,content:"Other" })).toBe(false);
  expect(sameConfirmationPayload(memory, { ...exact,type:"fact" })).toBe(false);
  expect(sameConfirmationPayload(memory, { ...exact,topicKey:null })).toBe(false);
  expect(sameConfirmationPayload(memory, { ...exact,pinned:false })).toBe(false);
});
