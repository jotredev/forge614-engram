import { expect, test } from "bun:test";
import { compatibilitySnapshots } from "./__test-support__/confirmation-fixtures";
import { assertExtension, canonical, emptySnapshot, normalizeSnapshot, reconcile, snapshotHash, validateSnapshot, type SyncSnapshotV3 } from "./snapshot";

test("format normalization never changes the original CAS payload", () => {
  const old = emptySnapshot();
  const originalHash = snapshotHash(old);
  const current = normalizeSnapshot(old);
  expect(JSON.stringify(old)).toBe('{"format":1,"projects":[],"memories":[]}');
  expect(originalHash).toBe("16f4b05aff0d3ab377ee502c3fb6843d93ad2039feb825ae64de95fe5ce82ba8");
  expect(JSON.stringify(current)).toBe('{"format":2,"projects":[],"memories":[],"sessions":[],"sessionEntries":[],"sessionSummaries":[]}');
  expect(snapshotHash(current)).toBe("b5ed0a9907e8376f25d09296a44dbbdf19ce7a542918d2e452d6ef0cae0a2fc6");
  expect(current.format).toBe(2);
  expect(current.sessions).toEqual([]);
  expect(snapshotHash(old)).toBe(originalHash);
  expect(snapshotHash(current)).not.toBe(originalHash);
  expect(() => assertExtension(current, old)).toThrow();
});

test("non-empty historical format 1 and 2 payload bytes and hashes remain compatible",()=>{
  const {one,two}=compatibilitySnapshots();
  expect(()=>validateSnapshot(one)).not.toThrow();expect(()=>validateSnapshot(two)).not.toThrow();
  expect(JSON.stringify(one)).toBe('{"format":1,"projects":[{"projectId":"11111111-1111-4111-8111-111111111111","name":"Primary","createdAt":"2026-09-17T10:00:00.000Z","updatedAt":"2026-09-17T10:00:00.000Z"}],"memories":[{"memory":{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","projectId":"11111111-1111-4111-8111-111111111111","scope":"project","topicKey":"storage","type":"decision","title":"Store","content":"SQLite plus WAL","pinned":false,"version":2,"createdAt":"2026-09-17T10:00:00.000Z","updatedAt":"2026-09-17T10:02:00.000Z","state":"active"},"versions":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","projectId":"11111111-1111-4111-8111-111111111111","scope":"project","topicKey":"storage","type":"decision","title":"Store","content":"SQLite","pinned":false,"version":1,"createdAt":"2026-09-17T10:00:00.000Z","updatedAt":"2026-09-17T10:00:00.000Z"},{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","projectId":"11111111-1111-4111-8111-111111111111","scope":"project","topicKey":"storage","type":"decision","title":"Store","content":"SQLite plus WAL","pinned":false,"version":2,"createdAt":"2026-09-17T10:00:00.000Z","updatedAt":"2026-09-17T10:02:00.000Z"}],"requests":[{"request_key":"create-store","payload_hash":"4fd0e710930e979b34b9c3c8f07dc1042b1cbdc2403e903086c57be48dc47b37","version":1},{"request_key":"revise-store","payload_hash":"4ae037118855846c006c2d0196850fd907f78be6077d6784300b33cec3809a16","version":2}],"events":[{"action":"save","version":1,"created_at":"2026-09-17T10:00:00.000Z"},{"action":"save","version":2,"created_at":"2026-09-17T10:02:00.000Z"}]}]}');
  expect(snapshotHash(one)).toBe("b23b7db1b1e0907d809360d01f22c1c5bc7d407d7c10e02543e466a03130e6f1");
  expect(JSON.stringify(two)).toBe('{"format":2,"projects":[{"projectId":"11111111-1111-4111-8111-111111111111","name":"Primary","createdAt":"2026-09-17T10:00:00.000Z","updatedAt":"2026-09-17T10:00:00.000Z"}],"memories":[{"memory":{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","projectId":"11111111-1111-4111-8111-111111111111","scope":"project","topicKey":"storage","type":"decision","title":"Store","content":"SQLite plus WAL","pinned":false,"version":2,"createdAt":"2026-09-17T10:00:00.000Z","updatedAt":"2026-09-17T10:02:00.000Z","state":"active"},"versions":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","projectId":"11111111-1111-4111-8111-111111111111","scope":"project","topicKey":"storage","type":"decision","title":"Store","content":"SQLite","pinned":false,"version":1,"createdAt":"2026-09-17T10:00:00.000Z","updatedAt":"2026-09-17T10:00:00.000Z"},{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","projectId":"11111111-1111-4111-8111-111111111111","scope":"project","topicKey":"storage","type":"decision","title":"Store","content":"SQLite plus WAL","pinned":false,"version":2,"createdAt":"2026-09-17T10:00:00.000Z","updatedAt":"2026-09-17T10:02:00.000Z"}],"requests":[{"request_key":"create-store","payload_hash":"4fd0e710930e979b34b9c3c8f07dc1042b1cbdc2403e903086c57be48dc47b37","version":1},{"request_key":"revise-store","payload_hash":"4ae037118855846c006c2d0196850fd907f78be6077d6784300b33cec3809a16","version":2}],"events":[{"action":"save","version":1,"created_at":"2026-09-17T10:00:00.000Z"},{"action":"save","version":2,"created_at":"2026-09-17T10:02:00.000Z"}]}],"sessions":[{"sessionId":"runtime-a","projectId":"11111111-1111-4111-8111-111111111111","kind":"runtime","startedAt":"2026-09-17T10:00:00.000Z","endedAt":null}],"sessionEntries":[{"sessionId":"runtime-a","memoryId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","version":1,"recordedAt":"2026-09-17T10:00:00.000Z"}],"sessionSummaries":[]}');
  expect(snapshotHash(two)).toBe("31e0bb25e1f8dad8f7f06de69e3379f745a4565df14105f36b54030849015d88");
});

test("format 3 normalization preserves the explicit promoted payload",()=>{
  const promoted:SyncSnapshotV3={format:3,projects:[],memories:[],sessions:[],sessionEntries:[],sessionSummaries:[],confirmations:[],confirmationRequests:[]};
  expect(normalizeSnapshot(promoted)).toBe(promoted);
  expect(()=>validateSnapshot(promoted)).not.toThrow();
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
