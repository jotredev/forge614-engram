/**
 * Formas de datos del ecosistema (grupo de proyectos que comparten reglas o contratos, p. ej. varios
 * repositorios de la misma persona). Un proyecto pertenece a un grupo, y dentro del grupo un solo
 * proyecto (la «fuente») puede escribir la nota de estado compartida. Llegan por `index.ts` a
 * `src/infrastructure/sqlite/ecosystem-groups.ts` y `board.ts` (que guardan y leen estos datos en
 * SQLite) y a `src/app/workspace.ts` y `memory-store.ts`.
 */
/** Cómo quedó vinculado un proyecto a su grupo: por un comando manual, por el archivo `forge614.node.json` de la máquina, o por un archivo de configuración del propio proyecto. */
export type MembershipSource = "command" | "node-file" | "project-file";
/** Un grupo de proyectos: su identificador (UUID), su nombre visible y cuándo se creó. */
export interface Group { id: string; name: string; createdAt: string }
/** El vínculo entre un proyecto y un grupo: qué proyecto, qué grupo, cuándo quedó vinculado y por qué medio (`source`). */
export interface GroupMembership { projectId: string; groupId: string; boundAt: string; source: MembershipSource }
/** Un grupo junto con la lista resumida (id y nombre) de los proyectos que pertenecen a él. */
export interface GroupSummary extends Group { projects: { projectId: string; name: string }[] }
/** El grupo de un proyecto concreto, junto con el medio (`source`) por el que quedó vinculado. */
export interface ProjectGroup { group: Group; source: MembershipSource }
/** Qué proyecto del grupo es la «fuente» autorizada a escribir la nota de estado del ecosistema, y cuándo se fijó. */
export interface GroupSource { groupId: string; projectId: string; setAt: string }
/**
 * Un evento de auditoría (registro histórico) de cambios de identidad de grupo o proyecto: creación de
 * grupo, cambio de nombre, vínculo o desvínculo de un proyecto. Guarda el estado anterior
 * (`previousGroupId`, `previousProjectId`) para poder reconstruir la historia completa.
 */
export interface IdentityEvent {
  id: number; action: string; projectId: string | null; groupId: string | null;
  previousGroupId: string | null; previousProjectId: string | null; memoryId: string | null; directory: string | null; createdAt: string;
}
