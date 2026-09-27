/**
 * Arma el contexto que un anfitrión (host) inyecta al arrancar una sesión de agente: lo
 * compartido entre proyectos, lo propio del ecosistema (grupo) si el proyecto pertenece a
 * uno, y lo propio del proyecto detectado a partir de la carpeta de trabajo actual.
 */
import type { ContextInput, ContextResult, StartupBlock } from "../modules/search";
import { MemoryStore } from "./memory-store";
import { resolveStartupProjectContext } from "./project-context";
import type { IdentityNotice } from "./project-identity";

/** Resultado de intentar identificar el proyecto de la carpeta actual al arrancar. */
export interface StartupProjectContext {
  /** Si la carpeta quedó ligada a un proyecto o no se pudo identificar ninguno. */
  status: "bound" | "unbound";
  /** Identificador del proyecto detectado, o `null` si la carpeta no está ligada a ninguno. */
  projectId: string | null;
  /** Contexto del proyecto detectado, o `null` si no hay proyecto. */
  context: ContextResult | null;
  /** Cómo se identificó el proyecto: por su propio archivo de identidad, por un vínculo de carpeta ya registrado, o no se identificó. */
  source: "file" | "path" | "unbound";
  /** Avisos generados al registrar o (re)ligar la carpeta a partir de su archivo de identidad, si los hubo. */
  notices?: IdentityNotice[];
}

/** Contexto del ecosistema (grupo de proyectos) al que pertenece el proyecto detectado, si pertenece a alguno. */
export type StartupEcosystemContext =
  | { status: "member"; group: { id: string; name: string }; context: ContextResult }
  | { status: "none" };

/**
 * `format` se mantiene en 1: `ecosystem` y `project.source` son campos añadidos después,
 * así que un consumidor que ignora campos desconocidos sigue funcionando sin cambios.
 */
export interface StartupContextResult {
  /** Versión del formato de este resultado; ver la nota de arriba sobre por qué no cambia. */
  format: 1;
  /** Contexto compartido entre todos los proyectos (memorias de alcance `shared`). */
  shared: ContextResult;
  /** Contexto del ecosistema del proyecto detectado, si pertenece a uno. */
  ecosystem: StartupEcosystemContext;
  /** Contexto del proyecto detectado a partir de la carpeta actual. */
  project: StartupProjectContext;
}

/** Contexto de un proyecto; si es miembro de un grupo, también trae su bloque de ecosistema (ausente para los demás). */
export type ProjectContextResult = ContextResult & { ecosystem?: Extract<StartupEcosystemContext, { status: "member" }> };
/**
 * Lee el contexto de un proyecto ya identificado por su id, añadiendo el contexto de su
 * grupo (ecosistema) cuando el proyecto pertenece a uno.
 * @param store Base abierta desde la que se lee.
 * @param projectId Identificador del proyecto cuyo contexto se quiere.
 * @param options Límites y filtros que se reenvían tal cual a `store.context`.
 * @returns El contexto del proyecto, con el bloque `ecosystem` añadido si aplica.
 */
export function readProjectContext(store: MemoryStore, projectId: string, options?: ContextInput): ProjectContextResult {
  const context = store.context(projectId, options);
  const member = store.groupOfProject(projectId);
  return member
    ? { ...context, ecosystem: { status: "member", group: { id: member.group.id, name: member.group.name }, context: store.contextForGroup(member.group.id, options) } }
    : context;
}

/**
 * Precarga no interactiva que un anfitrión (Shell, Engines) llama antes de que arranque una
 * sesión de agente. Nunca crea una memoria ni una sesión, y nunca crea un proyecto nuevo para
 * una carpeta sin vínculo previo (eso es un resultado normal, no un error): la resolución se
 * hace con `create=false` (ver `resolveStartupProjectContext`). Aun así, sí puede registrar el
 * proyecto y ligar o religar la carpeta cuando esta tiene su propio archivo de identidad
 * (`.forge614/project.json`): esa parte la hace `applyIdentityFile`, en `project-identity.ts`,
 * para mantener en paso el archivo de identidad del repositorio con la base local (un clon se
 * registra por su identidad, y un proyecto que solo estaba ligado por ruta recibe su archivo).
 * Cada bloque reutiliza el propio límite de bytes de `context()` (16384 por defecto), así que
 * el resultado combinado se queda dentro de un límite ya documentado.
 * @param store Base abierta desde la que se lee.
 * @param directory Carpeta de trabajo actual desde la que se identifica el proyecto.
 * @returns Formato 1: contexto compartido, contexto del ecosistema si aplica y contexto del proyecto detectado.
 */
export function readStartupContext(store: MemoryStore, directory: string): StartupContextResult {
  const shared = store.context(null);
  const resolved = resolveStartupProjectContext(store, directory);
  const ecosystem: StartupEcosystemContext = resolved.group
    ? { status: "member", group: resolved.group, context: store.contextForGroup(resolved.group.id) }
    : { status: "none" };
  const notices = resolved.notices ? { notices: resolved.notices } : {};
  // Sin proyecto identificado, se informa "unbound"; con proyecto, se trae su contexto completo y cómo se identificó.
  const project: StartupProjectContext = resolved.projectId === null
    ? { status: "unbound", projectId: null, context: null, source: "unbound" }
    : { status: "bound", projectId: resolved.projectId, context: store.context(resolved.projectId),
        source: resolved.source === "file" ? "file" : "path", ...notices };
  return { format: 1, shared, ecosystem, project };
}

/**
 * Formato 2: la misma resolución de proyecto que `readStartupContext`, pero entregada por
 * Engram como un único bloque de texto listo para inyectar, dentro de 5000 caracteres (ver
 * `startupBlock`). Los avisos de identidad no forman parte de este formato.
 * @param store Base abierta desde la que se lee.
 * @param directory Carpeta de trabajo actual desde la que se identifica el proyecto.
 * @returns El bloque de texto ya armado por `store.startupBlock`.
 */
export function readStartupBlock(store: MemoryStore, directory: string): StartupBlock {
  return store.startupBlock(resolveStartupProjectContext(store, directory).projectId);
}
