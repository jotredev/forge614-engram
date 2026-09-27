/**
 * Lecturas de memorias (memories, las notas guardadas) desde la base SQLite: convierte las filas
 * crudas de la tabla en objetos de dominio "Memory" y aplica la regla de propiedad (ownership) que
 * decide qué memorias puede ver cada quien, según sea un proyecto, el ámbito compartido (shared) o
 * un grupo del ecosistema (ecosystem, un conjunto de proyectos relacionados entre sí). Lo usan otras
 * piezas de infraestructura de SQLite (por ejemplo writes.ts y search.ts) para no repetir la
 * cláusula SQL de propiedad en cada lugar donde se lee una memoria.
 * Piezas principales: Row (forma de una fila de la tabla), memory() (fila -> Memory), ownerClause()
 * (arma el SQL de propiedad), owner()/required() (normalizan entradas) y get()/getByTopic()/history()
 * (las lecturas expuestas al resto de la aplicación).
 */
import type { Database } from "bun:sqlite";
import { groupIdentity } from "../../modules/ecosystem";
import { type Memory,type MemoryOwner,type MemoryVersion } from "../../modules/memory";
import { projectIdentity } from "../../modules/projects";
import { MemoryError } from "../../shared/errors";
import { requireEcosystem } from "./ecosystem-groups";

/**
 * Forma exacta de una fila de la tabla `memories` tal como la entrega SQLite, antes de traducirla a
 * los nombres de dominio (snake_case, es decir con guiones bajos, en vez de camelCase). Campos:
 * `id` (identificador), `projectId` (proyecto dueño, o null si no es de un proyecto), `scope`
 * (ámbito: "project", "shared" o "ecosystem"), `topic_key` (clave de tema opcional para no duplicar
 * contenido sobre lo mismo), `type` (tipo de memoria), `title`, `content`, `pinned` (fijada: 1 o 0,
 * porque SQLite no tiene un tipo booleano), `version`, `state` (activa o archivada), `created_at`,
 * `updated_at` y `groupId` (grupo del ecosistema dueño, presente solo cuando scope es "ecosystem").
 */
export interface Row {
  id: string; projectId: string | null; scope: Memory["scope"]; topic_key: string | null; type: Memory["type"];
  title: string; content: string; pinned: number; version: number;
  state: Memory["state"]; created_at: string; updated_at: string; groupId?: string | null;
}
/**
 * Convierte una fila cruda de SQLite (Row) al objeto de dominio Memory: pasa los nombres a
 * camelCase, `pinned` de 0/1 a boolean y agrega `groupId` solo cuando corresponde.
 * @param row fila leída de la tabla `memories`.
 * @returns la memoria en su forma de dominio, lista para el resto de la aplicación.
 */
export function memory(row: Row): Memory {
  return { id: row.id, projectId: row.projectId, scope: row.scope, topicKey: row.topic_key, type: row.type,
    title: row.title, content: row.content, pinned: row.pinned === 1,
    version: row.version, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at,
    // Solo una memoria del ecosistema (scope "ecosystem") lleva groupId; las demás no agregan la propiedad.
    ...(row.scope === "ecosystem" && row.groupId ? { groupId: row.groupId } : {}) };
}
/**
 * Arma el fragmento SQL (y sus parámetros posicionales) que filtra las memorias por dueño (owner):
 * un proyecto, el ámbito compartido (shared, dueño null) o un grupo del ecosistema. Se usa como
 * condición dentro del WHERE de las consultas de este archivo.
 * @param db base de datos SQLite abierta.
 * @param owner dueño a filtrar: id de proyecto, null para shared, o { groupId } para un grupo.
 * @param alias prefijo de la tabla en el SQL (por defecto "m.", alias de la tabla `memories`).
 * @returns el SQL de la condición y la lista de argumentos para sus signos de interrogación "?".
 * @throws MemoryError con código MIGRATION_REQUIRED si se pide un grupo y la base todavía no tiene
 * habilitado el ecosistema; con código INVALID_INPUT si el owner no es un identificador válido.
 */
export function ownerClause(db: Database, owner: MemoryOwner, alias = "m."): { sql: string; args: string[] } {
  if (owner !== null && typeof owner === "object") {
    // Un owner objeto (con groupId) exige que el esquema tenga habilitado el ecosistema.
    requireEcosystem(db);
    return { sql: `${alias}scope='ecosystem' AND ${alias}groupId=?`, args: [groupIdentity(owner.groupId)] };
  }
  // owner null representa el ámbito compartido (shared): no hay dueño particular.
  if (owner === null) return { sql: `${alias}scope='shared'`, args: [] };
  // Cualquier otro valor es el id de un proyecto.
  return { sql: `${alias}scope='project' AND ${alias}projectId=?`, args: [projectIdentity(owner)] };
}
/**
 * Normaliza un id de proyecto a la forma que usa la base: null se queda como null (ámbito shared)
 * y cualquier otro valor se valida como identificador de proyecto.
 * @param projectId id de proyecto, o null para el ámbito compartido.
 * @returns el id validado, o null.
 * @throws MemoryError con código INVALID_INPUT si projectId no es un id de proyecto válido.
 */
export function owner(projectId: string | null): string | null {
  return projectId === null ? null : projectIdentity(projectId);
}
/**
 * Valida que un valor sea un texto no vacío y sin caracteres nulos, y le quita los espacios de
 * los extremos. Se usa para validar ids y claves de tema (topic key) antes de usarlos en el SQL.
 * @param value valor a validar.
 * @param field nombre del campo, solo para el mensaje de error.
 * @returns el texto ya sin espacios en los extremos.
 * @throws MemoryError con código INVALID_INPUT si value no es texto, está vacío o contiene el
 * carácter nulo ("\0").
 */
export function required(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new MemoryError("INVALID_INPUT", `El campo ${field} debe ser texto no vacío y sin caracteres nulos.`);
  }
  return value.trim();
}

/**
 * Busca una memoria por id, dentro del dueño (owner) indicado. Si la memoria existe pero es de
 * otro dueño, se comporta igual que si no existiera (devuelve null): así un proyecto nunca ve
 * memorias de otro.
 * @param db base de datos SQLite abierta.
 * @param owner dueño al que debe pertenecer la memoria.
 * @param id identificador de la memoria.
 * @returns la memoria en forma de dominio, o null si no existe para ese dueño.
 * @throws MemoryError con código INVALID_INPUT si id no es un texto válido, o los códigos de
 * ownerClause si el owner no es válido.
 */
export function get(db: Database, owner: MemoryOwner, id: string): Memory | null {
    const clause = ownerClause(db, owner);
    const row = db.query(`SELECT * FROM memories m WHERE ${clause.sql} AND m.id=?`).get(...clause.args,required(id,"id")) as Row | null;
    return row ? memory(row) : null;
  }

/**
 * Busca una memoria por su clave de tema (topic key, la etiqueta que evita duplicar contenido
 * sobre un mismo asunto), dentro del dueño indicado.
 * @param db base de datos SQLite abierta.
 * @param owner dueño al que debe pertenecer la memoria.
 * @param topicKey clave de tema a buscar.
 * @returns la memoria en forma de dominio, o null si no existe para ese dueño y esa clave.
 * @throws MemoryError con código INVALID_INPUT si topicKey no es un texto válido, o los códigos de
 * ownerClause si el owner no es válido.
 */
export function getByTopic(db: Database, owner: MemoryOwner, topicKey: string): Memory | null {
    const clause = ownerClause(db, owner);
    const row = db.query(`SELECT * FROM memories m WHERE ${clause.sql} AND m.topic_key=?`).get(...clause.args,required(topicKey,"topicKey")) as Row | null;
    return row ? memory(row) : null;
  }

/**
 * Devuelve el historial completo de versiones de una memoria, en el orden en que se guardaron
 * (de la más vieja a la más nueva). Cada versión quedó grabada como una foto (snapshot) en texto
 * JSON en su momento, y aquí se decodifica de vuelta.
 * @param db base de datos SQLite abierta.
 * @param owner dueño al que debe pertenecer la memoria.
 * @param id identificador de la memoria.
 * @returns la lista de versiones, vacía si la memoria no existe para ese dueño.
 * @throws MemoryError con código INVALID_INPUT si id no es un texto válido, o los códigos de
 * ownerClause si el owner no es válido.
 */
export function history(db: Database, owner: MemoryOwner, id: string): MemoryVersion[] {
    const clause = ownerClause(db, owner);
    // El JOIN con memories aplica la misma cláusula de propiedad a las versiones históricas.
    const rows = db.query(`SELECT v.snapshot FROM memory_versions v JOIN memories m ON m.id=v.memory_id WHERE ${clause.sql} AND m.id=? ORDER BY v.version`)
      .all(...clause.args,required(id,"id")) as { snapshot: string }[];
    // Cada snapshot se guardó como texto JSON; aquí se decodifica de vuelta a objeto.
    return rows.map(row => JSON.parse(row.snapshot) as MemoryVersion);
  }
