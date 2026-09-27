/**
 * Tipo de error de dominio (`MemoryError`) que usa el resto del proyecto para lanzar fallos con un código
 * de máquina (por ejemplo `INVALID_INPUT`) además del mensaje legible; oculta automáticamente cualquier
 * URL de PostgreSQL que aparezca en el mensaje para no filtrar credenciales en logs ni respuestas.
 */
const postgresUrl = /\bpostgres(?:ql)?:\/\/[^\s"'`]+/giu;

/**
 * Sustituye cualquier URL de conexión a PostgreSQL (con o sin `ql`, con usuario y contraseña) que aparezca
 * en el texto por un marcador fijo, para que un mensaje de error nunca exponga credenciales.
 * @param message Texto del mensaje de error que puede contener una o más URLs de PostgreSQL.
 * @returns El mismo texto con cada URL de PostgreSQL reemplazada por «[URL de PostgreSQL oculta]».
 */
function redactPostgresUrls(message: string): string {
  return message.replace(postgresUrl, "[URL de PostgreSQL oculta]");
}

/**
 * Error de dominio (error de negocio, no de programación) que se lanza en toda la aplicación cuando una
 * operación no se puede completar por una razón conocida (dato inválido, recurso no encontrado, etc.).
 */
export class MemoryError extends Error {
  /**
   * @param code Código de máquina que identifica el tipo de fallo (p. ej. `INVALID_INPUT`,
   * `GROUP_NOT_FOUND`), pensado para que quien llame decida qué hacer sin analizar el texto.
   * @param message Mensaje legible para personas; si contiene una URL de PostgreSQL, se oculta antes de
   * guardarse.
   */
  constructor(public readonly code: string, message: string) {
    super(redactPostgresUrls(message));
    this.name = "MemoryError";
  }
}
