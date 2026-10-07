/**
 * Utilidades compartidas por pruebas de todo el proyecto para trabajar con una base de datos SQLite
 * temporal en memoria o con una carpeta temporal en disco, garantizando que ambas se cierren o se borren
 * al terminar aunque la prueba lance. La usan pruebas de `src/infrastructure` (20 de `sqlite`, 2 de
 * `filesystem` y 1 de `git`); ninguna de `src/app` ni de `src/interfaces`.
 */
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../sqlite/connection";

/**
 * Abre una base de datos SQLite en memoria, ya con su esquema inicializado, la pasa a la función dada y la
 * cierra al terminar, incluso si `run` lanza.
 * @param run Función de prueba que recibe la base de datos abierta.
 */
export function withDatabase(run: (db: Database) => void): void {
  const db = openDatabase(":memory:", {});
  try { run(db); } finally { db.close(); }
}

/**
 * Crea una carpeta temporal única, la pasa a la función dada y la borra por completo al terminar, incluso
 * si `run` lanza.
 * @param run Función de prueba que recibe la ruta de la carpeta temporal, expandida en Windows con su nombre largo.
 */
export function withDirectory(run: (directory: string) => void): void {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), "engram-adapter-")));
  try { run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}
