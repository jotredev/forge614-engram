/**
 * Abre y cierra la conexión (enlace) cruda a SQLite (bun:sqlite): crea la carpeta contenedora
 * si falta, aplica permisos restrictivos al archivo y deja que schema.ts corra las migraciones
 * (los cambios de estructura de las tablas) antes de entregar la base lista para usarse.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { required } from "./memory";
import { initialize } from "./schema";
export { defaultDatabasePath } from "../filesystem/paths";
export type { Database } from "bun:sqlite";

/**
 * Abre la base SQLite en `path` y deja el esquema (la estructura de tablas) ya inicializado.
 * @param path Ruta del archivo de base de datos, o ":memory:" para una base temporal en memoria.
 * @param options.create Si se permite crear la base cuando no existe (por defecto sí, salvo en modo de solo lectura).
 * @param options.readonly Si la conexión debe abrirse en modo de solo lectura.
 * @returns La conexión ya abierta y con el esquema inicializado.
 * @throws Lo que lance `initialize` al migrar el esquema; en ese caso la conexión se cierra antes de propagar el error.
 */
export function openDatabase(path: string, options: {create?: boolean; readonly?: boolean}): Database {
  required(path, "path");
  const create = options.create ?? !options.readonly;
  // Sin la carpeta contenedora, bun:sqlite no puede crear el archivo; se omite para la base en memoria.
  if (create && path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { create, readwrite: !options.readonly, readonly: options.readonly ?? false, strict: true });
  try { initialize(db, create, options.readonly ?? false); }
  // Si el esquema no pudo inicializarse, se cierra la conexión para no dejar el archivo abierto sin usarse.
  catch (error) { db.close(); throw error; }
  return db;
}

/** Cierra la conexión SQLite. */
export function closeDatabase(db: Database): void { db.close(); }
