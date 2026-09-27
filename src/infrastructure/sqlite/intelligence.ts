/**
 * Comprueba si la "inteligencia" (búsqueda híbrida y puntuación avanzada de memoria) está
 * activa en esta base. Todo lo que depende de esas funciones consulta primero este archivo.
 */
import type { Database } from "bun:sqlite";
import { schemaFeatures } from "./schema";

/**
 * Dice si la inteligencia está activa en esta base de datos.
 * Verdadero solo en el nivel 11 del esquema (versión de la estructura de tablas); toda
 * función de inteligencia depende de esta comprobación antes de usarse.
 * @param db conexión abierta a la base SQLite.
 * @returns true si el nivel de esquema tiene la inteligencia activada.
 */
export function intelligenceEnabled(db: Database): boolean { return schemaFeatures(db)?.intelligence === true; }
