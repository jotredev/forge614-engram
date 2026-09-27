/** Punto de entrada del módulo `synchronization`: reexporta los tipos y funciones de instantáneas (validación, reconciliación) y las identidades de petición de confirmación. */
export type { MemoryBundle,SyncSnapshotV1,SyncSnapshotV2,SyncSnapshotV3,SyncSnapshot } from "./snapshot";
export { emptySnapshot,normalizeSnapshot,syncError,canonical,snapshotHash,validateSnapshot,reconcile,assertExtension,sessionEntryIdentity } from "./snapshot";
export { confirmationRequestIdentity,requestOwnerKey } from "./confirmations";
