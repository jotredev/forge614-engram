/**
 * Detecta si un texto contiene un secreto (contraseña, token, llave privada, etc.) antes de guardarlo
 * como recuerdo, para poder rechazar el guardado en vez de almacenar el secreto. Lo usa
 * `src/infrastructure/sqlite/writes.ts` al validar el contenido de un `memory_save`.
 */
// Credenciales que nunca deben guardarse en la memoria. El id nombra el tipo de secreto para que quien
// llama pueda decir qué quitar; el valor que hizo coincidir el patrón nunca se devuelve ni se repite.
const SECRET_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["private-key", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/u],
  ["aws-access-key-id", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/u],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/u],
  ["sk-key", /\bsk-(?:[A-Za-z0-9_-]{2,20}-)?[A-Za-z0-9]{32,}\b/u],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/u],
  ["connection-string-with-credentials", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/iu],
];

// Una palabra clave (password, api_key, …) seguida de un valor literal. El valor debe terminar en
// comilla, espacio, coma, punto y coma o fin del texto, así los marcadores (<...>), rutas de archivo y
// llamadas a función nunca coinciden (no son un valor real, solo mencionan la palabra clave).
const ASSIGNMENT = /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?([A-Za-z0-9+=_.!@#$%^&*~-]{8,})(?=["'\s,;]|$)/giu;
// Valores que nombran un secreto en vez de contenerlo: nombres de variable de entorno, referencias de
// código con puntos y máscaras de asteriscos; se excluyen para no marcar una mención como un secreto real.
const NOT_A_VALUE = /^(?:[A-Z]+|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|\*+)$/u;

/**
 * Busca en el texto el primer patrón de secreto conocido (llave privada, token de proveedor conocido,
 * o una asignación tipo `password: valor`) y devuelve su identificador.
 * @param text Texto a examinar, típicamente el contenido de un recuerdo antes de guardarlo.
 * @returns El id del primer patrón encontrado (p. ej. "github-token", "password-assignment"), o `null` si no se encontró ninguno.
 */
export function findSecret(text: string): string | null {
  for (const [id, pattern] of SECRET_PATTERNS) if (pattern.test(text)) return id;
  for (const match of text.matchAll(ASSIGNMENT)) if (!NOT_A_VALUE.test(match[1]!)) return "password-assignment";
  return null;
}
