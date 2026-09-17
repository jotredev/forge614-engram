import { expect, test } from "bun:test";
import { assertExtension, canonical, emptySnapshot, normalizeSnapshot, reconcile, snapshotHash, validateSnapshot } from "./snapshot";

test("format normalization never changes the original CAS payload", () => {
  const old = emptySnapshot();
  const originalHash = snapshotHash(old);
  const current = normalizeSnapshot(old);
  expect(current.format).toBe(2);
  expect(current.sessions).toEqual([]);
  expect(snapshotHash(old)).toBe(originalHash);
  expect(snapshotHash(current)).not.toBe(originalHash);
  expect(() => assertExtension(current, old)).toThrow();
});

test("canonical serialization sorts nested object keys while preserving array order", () => {
  expect(canonical({z:[{b:2,a:1},0],a:"text"})).toBe('{"a":"text","z":[{"a":1,"b":2},0]}');
});

test("snapshot validation rejects unknown fields and duplicate project identities", () => {
  const project = {projectId:"12345678-1234-4234-8234-123456789abc",name:"Project",createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"};
  expect(() => validateSnapshot({format:1,projects:[project],memories:[]})).not.toThrow();
  for (const snapshot of [{format:1,projects:[project,project],memories:[]},{format:1,projects:[],memories:[],unexpected:true}]) {
    expect(() => validateSnapshot(snapshot)).toThrow(expect.objectContaining({code:"SYNC_INVALID"}));
  }
});

test("reconciliation retains independent additions and refuses conflicting edits", () => {
  const first = {projectId:"12345678-1234-4234-8234-123456789abc",name:"First",createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"};
  const second = {...first,projectId:"22345678-1234-4234-8234-123456789abc",name:"Second"};
  const base = emptySnapshot();
  expect(reconcile(base,{...base,projects:[first]},{...base,projects:[second]}).projects).toEqual([first,second]);
  expect(() => reconcile({...base,projects:[first]},{...base,projects:[{...first,name:"Local"}]},{...base,projects:[{...first,name:"Remote"}]})).toThrow(expect.objectContaining({code:"SYNC_CONFLICT"}));
});
