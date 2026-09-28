/**
 * Tarea en segundo plano del servidor MCP (D7) que sube la cola pendiente y baja los cambios nuevos
 * cada 30 s (y al guardar, agrupado con un pequeño retraso), y espera de arranque (D8) que baja y
 * aplica con un tope de 1000 ms antes de leer el contexto local. Ambas comparten, por cada
 * `MemoryStore`, una sola conexión perezosa y un solo ciclo de aplicación en vuelo: nunca se llama
 * `applyCloudChanges` dos veces a la vez, y el tope de la espera cancela de verdad el ciclo que
 * encuentre en curso (propio o de la tarea de fondo). La usa `src/interfaces/mcp/server.ts` (la tarea
 * de fondo) y `memory_context`/`startup-context` (la espera de arranque), ambas a través de
 * `src/app/index.ts`.
 */
import type { MemoryStore } from "./memory-store";
import { cloudSettings, connectCloudReplica } from "./cloud-settings";
import type { CloudReplica } from "./cloud-sync";
export type { CloudReplica } from "./cloud-sync";

/** Tarea de fondo ya arrancada: `notifySave` agenda un ciclo agrupado tras un guardado; `stop` la apaga. */
export interface CloudBackgroundTask {
  /** Agenda un ciclo de subida y bajada tras `saveDelayMs`; varios guardados seguidos reinician el mismo temporizador (se agrupan en un solo ciclo). */
  notifySave(): void;
  /** Detiene el intervalo y cualquier temporizador de guardado pendiente, cancela un ciclo en vuelo (que no aplicará nada al terminar) y cierra la conexión sin esperar. */
  stop(): void;
}

/** Opciones de la tarea de fondo, pensadas para pruebas: los tiempos y la fábrica de conexión son inyectables. */
export interface CloudBackgroundOptions {
  /** Milisegundos entre ciclos mientras el servidor vive; por defecto 30000 (D7). */
  intervalMs?: number;
  /** Milisegundos de retraso tras un guardado antes de correr un ciclo agrupado; por defecto 2000. */
  saveDelayMs?: number;
  /** Fábrica de la conexión a la réplica; por defecto conecta de verdad a `cloudSettings()!.postgresUrl`. Una prueba puede dar un doble (fake) lento o que falla. */
  connect?: () => Promise<CloudReplica>;
}

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_SAVE_DELAY_MS = 2_000;
const DEFAULT_WAIT_TIMEOUT_MS = 1_000;

/**
 * Estado compartido por instalación (aquí, por instancia de `MemoryStore`: en un proceso real hay una
 * sola instancia viva a la vez, y cada prueba usa la suya propia, así que no hay fuga entre pruebas).
 * Guarda la conexión perezosa, el ciclo en vuelo (si lo hay) con el controlador que puede cancelarlo,
 * y si esta instancia tiene una tarea de fondo dueña de la conexión (para decidir quién la cierra).
 */
interface SharedCloudState {
  /** La conexión ya en marcha (o resuelta) a la réplica, o `null` si todavía no se pidió ninguna. */
  connection: Promise<CloudReplica> | null;
  /** El ciclo (subida+bajada, o solo bajada) que está en vuelo ahora mismo, o `null` si ninguno lo está. */
  cycle: Promise<void> | null;
  /** El controlador de cancelación del ciclo en vuelo (el mismo `cycle`), o `null` junto con él. */
  cycleAbort: AbortController | null;
  /** Si hay una tarea de fondo (`startCloudBackground`) dueña de `connection`, para que `waitForCloud` no la cierre por su cuenta. */
  hasBackground: boolean;
}
const sharedStates = new WeakMap<MemoryStore, SharedCloudState>();
/** Da el estado compartido de `store`, creándolo la primera vez que se pide. */
function stateOf(store: MemoryStore): SharedCloudState {
  let state = sharedStates.get(store);
  if (!state) { state = { connection: null, cycle: null, cycleAbort: null, hasBackground: false }; sharedStates.set(store, state); }
  return state;
}

/**
 * Da la conexión perezosa compartida de `state`, creándola con `connect` si hace falta. Un intento
 * que termina en error se quita de `state` al fallar (no se deja cacheado un fallo para siempre): así
 * el próximo ciclo vuelve a intentar conectar en vez de repetir el mismo error sin volver a intentarlo.
 * @param state Estado compartido de la instalación.
 * @param connect Fábrica de la conexión a usar si todavía no hay ninguna en marcha.
 * @returns La conexión en marcha (nueva o ya existente).
 */
function lazyConnection(state: SharedCloudState, connect: () => Promise<CloudReplica>): Promise<CloudReplica> {
  if (!state.connection) {
    const attempt = connect();
    state.connection = attempt;
    attempt.catch(() => { if (state.connection === attempt) state.connection = null; });
  }
  return state.connection;
}

/**
 * Arranca un ciclo nuevo con su propio controlador de cancelación, lo registra como el ciclo vigente
 * de `state` (para el gate de "un solo ciclo en vuelo" y para que `stop()`/el tope de espera puedan
 * cancelarlo de verdad) y lo desregistra cuando termine, sin dejar ninguna promesa sin atender.
 * @param state Estado compartido de la instalación.
 * @param body Cuerpo del ciclo, que recibe la señal de cancelación de este ciclo.
 * @returns El ciclo ya en marcha.
 */
function startTrackedCycle(state: SharedCloudState, body: (signal: AbortSignal) => Promise<void>): Promise<void> {
  const controller = new AbortController();
  state.cycleAbort = controller;
  const cycle = body(controller.signal);
  state.cycle = cycle;
  // Se limpia con .then(onFulfilled, onRejected) en vez de .finally: así la promesa que .then() devuelve
  // nunca rechaza por su cuenta, y no hay riesgo de un rechazo sin atender aparte del propio `cycle`.
  const clear = () => { if (state.cycle === cycle) { state.cycle = null; state.cycleAbort = null; } };
  cycle.then(clear, clear);
  return cycle;
}

/**
 * Arranca la tarea de fondo de sincronización con la nube para `store` (D7): un ciclo inmediato al
 * llamarla (para subir lo que se quedó pendiente sin internet mientras el servidor estaba apagado) y
 * luego un ciclo cada `intervalMs`, más un ciclo agrupado al guardar (`notifySave`). No hace nada (ni
 * conecta) si `store.cloudEnabled()` es falso o si no hay configuración de nube completa (guardia de
 * nube, D1: sin nube, ni la base ni el arranque cambian).
 * @param store Almacén de memoria cuyo `cloud_outbox`/`cloud_state` se sincroniza.
 * @param options Tiempos y fábrica de conexión inyectables (para pruebas).
 * @returns La tarea ya arrancada, o `null` si no hay nube que sincronizar.
 */
export function startCloudBackground(store: MemoryStore, options: CloudBackgroundOptions = {}): CloudBackgroundTask | null {
  // Guardia de nube: sin nivel 12 o sin configuración completa, no se conecta nada.
  if (!store.cloudEnabled()) return null;
  const settings = cloudSettings();
  if (!settings) return null;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const saveDelayMs = options.saveDelayMs ?? DEFAULT_SAVE_DELAY_MS;
  const connect = options.connect ?? (() => connectCloudReplica(settings.postgresUrl));
  const state = stateOf(store);
  state.hasBackground = true;

  let stopped = false;
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;

  // Conexión perezosa compartida: se crea una sola vez por instalación, incluso si varios ciclos la piden a la vez.
  const connection = (): Promise<CloudReplica> => lazyConnection(state, connect);

  // Corre un ciclo nuevo, o se une al que ya esté en vuelo: nunca se llama `applyCloudChanges` dos veces a la vez.
  const runCycle = (): Promise<void> => {
    if (state.cycle) return state.cycle;
    return startTrackedCycle(state, async signal => {
      if (stopped) return;
      let replica: CloudReplica;
      try { replica = await connection(); }
      catch { return; } // D7: un error de conexión se traga en silencio; el siguiente ciclo reintenta.
      if (stopped) return; // Se detuvo mientras conectaba: no se toca un store que puede estar cerrado.
      try { await store.syncCloudCycle(replica, settings.installationId, signal); }
      catch { /* D7: cualquier error de red del ciclo se traga en silencio; se reintenta en el siguiente tick. */ }
    });
  };

  // Ciclo inmediato: sube lo que quedó pendiente mientras el servidor estaba apagado o sin internet.
  void runCycle();
  intervalHandle = setInterval(() => { if (!stopped) void runCycle(); }, intervalMs);
  intervalHandle.unref?.();

  return {
    notifySave(): void {
      if (stopped) return;
      // Varios guardados seguidos reinician el mismo temporizador: se agrupan en un solo ciclo.
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => { saveTimeout = null; void runCycle(); }, saveDelayMs);
      saveTimeout.unref?.();
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      state.cycleAbort?.abort(); // Cancela de verdad un ciclo en vuelo: al terminar, no aplicará nada.
      if (intervalHandle) clearInterval(intervalHandle);
      if (saveTimeout) clearTimeout(saveTimeout);
      intervalHandle = null; saveTimeout = null;
      state.hasBackground = false;
      const pending = state.connection; state.connection = null;
      // Se cierra sin esperar: la tarea de fondo ya no necesita la conexión, y el cierre del servidor no debe demorarse por ella.
      void pending?.then(replica => replica.close()).catch(() => {});
    },
  };
}

/**
 * Espera de arranque (D8, Foco de revisión #3): si hay nube configurada, baja y aplica los cambios
 * nuevos con un tope de `timeoutMs`; al vencer el tope, cancela de verdad el ciclo que encuentre en
 * curso (aborta su señal, que `pullChanges` traduce en `query.cancel()`) y vuelve de inmediato,
 * dejando la lectura siguiente con lo que hay en local. Si ya hay un ciclo de la tarea de fondo en
 * vuelo para este mismo `store`, se espera ESE ciclo en vez de empezar uno nuevo (nunca dos a la vez),
 * reutilizando también su misma conexión perezosa.
 * @param store Almacén de memoria a esperar.
 * @param timeoutMs Tope de espera en milisegundos; por defecto 1000 (D8).
 */
export async function waitForCloud(store: MemoryStore, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS): Promise<void> {
  if (!store.cloudEnabled()) return;
  const settings = cloudSettings();
  if (!settings) return;
  const state = stateOf(store);
  // Sin una tarea de fondo dueña de la conexión, esta llamada es la única que la va a usar: le toca cerrarla al terminar.
  const ownsConnection = !state.hasBackground;
  const connection = (): Promise<CloudReplica> => lazyConnection(state, () => connectCloudReplica(settings.postgresUrl));

  const run = async (): Promise<void> => {
    if (state.cycle) { await state.cycle; return; } // Se une al ciclo (propio o de la tarea de fondo) ya en vuelo.
    await startTrackedCycle(state, async signal => {
      const replica = await connection();
      await store.downloadCloudChanges(replica, settings.installationId, signal);
    });
  };

  let resolveTimeout = () => {};
  const timeout = new Promise<void>(resolve => { resolveTimeout = resolve; });
  const timer = setTimeout(() => { state.cycleAbort?.abort(); resolveTimeout(); }, timeoutMs);
  try {
    // Carrera entre bajar y aplicar, y el tope: la promesa perdedora nunca queda sin atender.
    await Promise.race([run().catch(() => {}), timeout]);
  } finally {
    clearTimeout(timer);
    if (ownsConnection) {
      const pending = state.connection; state.connection = null;
      // Se cierra sin esperar: el proceso (por ejemplo, la CLI) no debe demorarse por esta conexión.
      void pending?.then(replica => replica.close()).catch(() => {});
    }
  }
}
