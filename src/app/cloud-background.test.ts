/**
 * Comprueba `startCloudBackground` y `waitForCloud` con dobles (fakes) de `MemoryStore` y de
 * `CloudReplica`, controlando el tiempo real (sin simular relojes): la guardia de nube (sin nivel 12
 * o sin configuración, no conecta nada), un solo ciclo en vuelo compartido entre el tick, `notifySave`
 * y `waitForCloud`, que los errores de red no lanzan ni dejan promesas sin atender, el tope de la
 * espera de arranque que cancela de verdad, y que `stop()` corta un ciclo en vuelo y detiene los ticks.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryStore } from "./memory-store";
import { startCloudBackground, waitForCloud, type CloudReplica } from "./cloud-background";

let directory = "";
let previousHome: string | undefined;
// Cada prueba usa su propio $FORGE614_HOME temporal (mismo patrón que cloud-settings.test.ts), con una
// configuración de nube completa ya escrita, para que `cloudSettings()` (que estas funciones llaman de
// verdad) encuentre postgresUrl e installationId sin depender de qué prueba corrió antes.
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "forge614-cloud-background-"));
  previousHome = process.env.FORGE614_HOME;
  process.env.FORGE614_HOME = join(directory, ".forge614");
  const root = join(directory, ".forge614", "engram");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, ".env"),
    'FORMAT_VERSION="3"\nSTORAGE="sqlite"\nPOSTGRES_URL="postgresql://u@127.0.0.1/db?sslmode=disable"\nFORGE614_ENGRAM_INSTALLATION_ID="3f6a9e2c-1b3d-4a5e-9c7f-0a1b2c3d4e5f"\n',
    { mode: 0o600 });
});
afterEach(() => {
  if (previousHome === undefined) delete process.env.FORGE614_HOME; else process.env.FORGE614_HOME = previousHome;
  rmSync(directory, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
/** Un doble de `CloudReplica` que nunca hace nada por sí solo: basta para satisfacer el tipo cuando el propio `MemoryStore` doble es el que controla el tiempo. */
function noopReplica(): CloudReplica {
  return { async pushChanges() { return { ids: [] }; }, async pullChanges() { return []; }, async close() {} };
}
/** Arma un doble mínimo de `MemoryStore`: solo implementa lo que `cloud-background.ts` usa. */
function fakeStore(overrides: {
  cloudEnabled?: () => boolean;
  syncCloudCycle?: MemoryStore["syncCloudCycle"];
  downloadCloudChanges?: MemoryStore["downloadCloudChanges"];
} = {}): MemoryStore {
  return {
    cloudEnabled: overrides.cloudEnabled ?? (() => true),
    syncCloudCycle: overrides.syncCloudCycle ?? (async () => ({ uploaded: 0, downloaded: 0 })),
    downloadCloudChanges: overrides.downloadCloudChanges ?? (async () => {}),
  } as unknown as MemoryStore;
}
/** Un `AbortSignal` es "abortado antes de tiempo" si ya lo está cuando la prueba lo revisa; ayuda a leer las aserciones. */
const aborted = (signal?: AbortSignal) => signal?.aborted === true;

// Sin `cloudEnabled()`, startCloudBackground no arranca nada y no llama a connect.
test("startCloudBackground returns null and never calls connect when the store has no cloud level", () => {
  let calls = 0;
  const task = startCloudBackground(fakeStore({ cloudEnabled: () => false }), { connect: async () => { calls++; return noopReplica(); } });
  expect(task).toBeNull();
  expect(calls).toBe(0);
});

// Con nivel 12 pero sin configuración de nube completa (sin `.env` de nube), tampoco arranca ni conecta.
test("startCloudBackground returns null and never calls connect when there is no complete cloud configuration", () => {
  rmSync(join(directory, ".forge614"), { recursive: true, force: true }); // Sin POSTGRES_URL/installationId: cloudSettings() da null.
  let calls = 0;
  const task = startCloudBackground(fakeStore(), { connect: async () => { calls++; return noopReplica(); } });
  expect(task).toBeNull();
  expect(calls).toBe(0);
});

// Con nube completa, sí arranca (aunque no haga nada útil el ciclo, con un store que resuelve enseguida).
test("startCloudBackground starts a task when cloud is fully configured", () => {
  const task = startCloudBackground(fakeStore(), { connect: async () => noopReplica(), intervalMs: 60_000 });
  expect(task).not.toBeNull();
  task?.stop();
});

// stop() de verdad limpia el intervalo con clearInterval (no solo confía en la bandera "detenida" interna).
test("stop() clears the interval timer instead of only relying on the internal stopped flag", () => {
  const originalClearInterval = globalThis.clearInterval;
  const cleared: unknown[] = [];
  globalThis.clearInterval = ((handle: unknown) => { cleared.push(handle); return originalClearInterval(handle as never); }) as typeof clearInterval;
  try {
    const task = startCloudBackground(fakeStore(), { connect: async () => noopReplica(), intervalMs: 60_000 });
    expect(task).not.toBeNull();
    task?.stop();
    expect(cleared).toHaveLength(1);
  } finally { globalThis.clearInterval = originalClearInterval; }
});

// Un error de red en el ciclo (aquí, al conectar) no lanza ni deja una promesa sin atender; la cola se conserva y el siguiente tick reintenta con éxito.
test("a network error in the cycle never throws or leaves an unhandled rejection; the next tick retries", async () => {
  let attempts = 0, succeeded = 0;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const task = startCloudBackground(fakeStore({
      syncCloudCycle: async () => { succeeded++; return { uploaded: 0, downloaded: 0 }; },
    }), {
      connect: async () => { attempts++; if (attempts === 1) throw new Error("network down"); return noopReplica(); },
      intervalMs: 30,
    });
    expect(task).not.toBeNull();
    await sleep(150); // Dos o más ticks: el primero falla al conectar, uno de los siguientes conecta bien.
    task?.stop();
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(succeeded).toBeGreaterThanOrEqual(1);
    expect(unhandled).toEqual([]);
  } finally { process.off("unhandledRejection", onUnhandled); }
}, 5000);

// Lo mismo, pero el error ocurre dentro del ciclo ya conectado (no al conectar): store.syncCloudCycle
// lanza en el primer tick y funciona en el siguiente; tampoco debe lanzar ni dejar nada sin atender.
test("an error inside an already-connected cycle never throws or leaves an unhandled rejection; the next tick retries", async () => {
  let calls = 0;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const task = startCloudBackground(fakeStore({
      syncCloudCycle: async () => { calls++; if (calls === 1) throw new Error("cycle boom"); return { uploaded: 0, downloaded: 0 }; },
    }), { connect: async () => noopReplica(), intervalMs: 30 });
    expect(task).not.toBeNull();
    await sleep(150);
    task?.stop();
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(unhandled).toEqual([]);
  } finally { process.off("unhandledRejection", onUnhandled); }
}, 5000);

// Un solo ciclo en vuelo: un tick del intervalo y notifySave() casi al mismo tiempo terminan en una sola llamada real al ciclo.
test("a tick and notifySave at nearly the same time share a single in-flight cycle", async () => {
  let calls = 0;
  const task = startCloudBackground(fakeStore({
    syncCloudCycle: async () => { calls++; await sleep(60); return { uploaded: 0, downloaded: 0 }; },
  }), { connect: async () => noopReplica(), intervalMs: 100_000, saveDelayMs: 10 });
  expect(task).not.toBeNull();
  // El ciclo inmediato del arranque ya está en vuelo (dura 60 ms); notifySave() agenda otro a los 10 ms,
  // que debe encontrar ese mismo ciclo todavía corriendo y unirse a él en vez de arrancar uno nuevo.
  task!.notifySave();
  await sleep(150);
  task!.stop();
  expect(calls).toBe(1);
});

// notifySave() llamado varias veces seguidas reinicia el mismo temporizador: solo corre un ciclo, no uno por llamada.
test("three notifySave calls in a row run only one grouped cycle", async () => {
  let calls = 0;
  const task = startCloudBackground(fakeStore({
    syncCloudCycle: async () => { calls++; return { uploaded: 0, downloaded: 0 }; },
  }), { connect: async () => noopReplica(), intervalMs: 100_000, saveDelayMs: 30 });
  await sleep(10); // Deja que el ciclo inmediato del arranque termine antes de empezar a contar.
  const afterStartup = calls;
  task!.notifySave(); await sleep(5);
  task!.notifySave(); await sleep(5);
  task!.notifySave();
  await sleep(80); // Más que saveDelayMs desde la última llamada.
  task!.stop();
  expect(calls - afterStartup).toBe(1);
});

// stop() con un ciclo en vuelo: al resolver más tarde, no aplica nada (su señal ya está abortada) y no lanza; y tras stop() no hay más ticks.
test("stop cancels an in-flight cycle's signal so it applies nothing when it later resolves, and stops further ticks", async () => {
  let calls = 0; let appliedAfterStop = false; let sawAbortedSignal = false;
  const task = startCloudBackground(fakeStore({
    syncCloudCycle: async (_replica, _installationId, signal) => {
      calls++;
      await sleep(60);
      if (aborted(signal)) sawAbortedSignal = true; else appliedAfterStop = true;
      return { uploaded: 0, downloaded: 0 };
    },
  }), { connect: async () => noopReplica(), intervalMs: 20 });
  await sleep(5); // El ciclo inmediato del arranque ya está en vuelo (dura 60 ms).
  task!.stop();
  await sleep(100); // Deja que el ciclo en vuelo termine, y que pasen intervalos de sobra si no se hubiera detenido.
  expect(sawAbortedSignal).toBe(true);
  expect(appliedAfterStop).toBe(false);
  const callsRightAfterStop = calls;
  await sleep(80);
  expect(calls).toBe(callsRightAfterStop); // Ningún tick nuevo después de stop().
});

// waitForCloud sin nube (guardia del store) vuelve enseguida sin llamar a `connect`.
test("waitForCloud returns immediately without connecting when the store has no cloud level", async () => {
  let calls = 0;
  await waitForCloud(fakeStore({ cloudEnabled: () => false }), 1000);
  expect(calls).toBe(0);
});

// Con un doble lento (1050 ms) tras un ciclo inicial rápido de la tarea de fondo, waitForCloud vuelve en ≤ 1000 ms + margen (1300 ms), sin excepción sin atender.
test("waitForCloud returns within the timeout plus margin when the download is slower than the cutoff", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const store = fakeStore({
      syncCloudCycle: async () => ({ uploaded: 0, downloaded: 0 }), // El ciclo inmediato de arranque de la tarea de fondo termina rápido.
      downloadCloudChanges: async () => { await sleep(1050); }, // La bajada que usa waitForCloud es la lenta.
    });
    const task = startCloudBackground(store, { connect: async () => noopReplica(), intervalMs: 100_000 });
    await sleep(20); // Deja que el ciclo inmediato de arranque (rápido) termine y libere `state.cycle`.
    const start = Date.now();
    await waitForCloud(store, 1000);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThanOrEqual(1300);
    task?.stop();
    expect(unhandled).toEqual([]);
  } finally { process.off("unhandledRejection", onUnhandled); }
}, 5000);

// Si la bajada resuelve 50 ms después del corte, no se aplica nada (la señal ya estaba abortada cuando terminó) y no hay excepción sin atender.
test("nothing is applied when the download resolves 50 ms after the cutoff", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    let applied = false, sawAbortedSignal = false;
    const store = fakeStore({
      syncCloudCycle: async () => ({ uploaded: 0, downloaded: 0 }),
      downloadCloudChanges: async (_replica, _installationId, signal) => {
        await sleep(120); // 50 ms después de un corte de 70 ms.
        if (aborted(signal)) sawAbortedSignal = true; else applied = true;
      },
    });
    const task = startCloudBackground(store, { connect: async () => noopReplica(), intervalMs: 100_000 });
    await sleep(20);
    await waitForCloud(store, 70);
    await sleep(150); // Deja que la bajada tardía termine de verdad.
    task?.stop();
    expect(applied).toBe(false);
    expect(sawAbortedSignal).toBe(true);
    expect(unhandled).toEqual([]);
  } finally { process.off("unhandledRejection", onUnhandled); }
}, 5000);

// La tarea de fondo nunca pasa `onProgress` al ciclo: el servidor MCP no escribe avance en ninguna parte.
test("the background task calls syncCloudCycle without an onProgress callback", async () => {
  const seen: unknown[] = [];
  const task = startCloudBackground(fakeStore({
    syncCloudCycle: (async (_replica: unknown, _installationId: unknown, _signal: unknown, onProgress: unknown) => {
      seen.push(onProgress); return { uploaded: 0, downloaded: 0 };
    }) as unknown as MemoryStore["syncCloudCycle"],
  }), { connect: async () => noopReplica(), intervalMs: 100_000 });
  await sleep(30);
  task?.stop();
  expect(seen.length).toBeGreaterThanOrEqual(1);
  expect(seen.every(value => value === undefined)).toBe(true);
});
