/**
 * Planificación de consultas en lenguaje natural para la búsqueda híbrida del nivel 11: quita palabras
 * vacías (artículos, preposiciones, etc.), une los términos restantes con OR, y arma dos consultas: una
 * para el índice de palabras (los términos de cuatro o más letras hacen coincidencia por prefijo) y otra
 * para el índice de trigramas (los términos de tres o más letras hacen coincidencia en cualquier parte
 * del texto). También calcula la similitud (índice de Jaccard) entre dos recuerdos para detectar
 * duplicados al guardar. Lo usa `src/infrastructure/sqlite/search.ts` al construir y ejecutar búsquedas.
 */
const STOPWORDS = new Set([
  "a","al","algo","ante","antes","aqui","asi","cada","como","con","contra","cual","cuales","cuando","de","del","desde","donde",
  "el","ella","ellas","ellos","en","entre","era","eres","es","esa","esas","ese","eso","esos","esta","estaba","estan","estas",
  "este","esto","estos","fue","fueron","ha","han","hay","la","las","le","les","lo","los","mas","me","mi","mis","muy","nos",
  "nosotros","o","otra","otras","otro","otros","para","pero","por","porque","pues","que","quien","se","sea","ser","si","sin",
  "sobre","son","su","sus","te","ti","tu","tus","u","un","una","unas","uno","unos","y","ya","yo",
  "an","and","are","as","at","be","been","but","by","can","did","do","does","for","from","had","has","have","how","i","if",
  "in","into","is","it","its","me","my","of","on","or","our","so","that","the","their","them","then","there","these","they",
  "this","to","was","we","were","what","when","where","which","who","why","will","with","you","your",
]);

/** Como máximo se envían estos términos a los índices; el resto de un texto largo se ignora. */
export const MAX_QUERY_TERMS = 16;
/** Un resultado debe contener al menos estos términos de la consulta (o todos, si la consulta tiene menos). */
export const MIN_MATCHED_TERMS = 2;
/** Constante de fusión de rangos recíprocos (RRF): un resultado puntúa 1/(RRF_K + posición) en cada índice que lo devuelve. */
export const RRF_K = 60;
/** Candidatos leídos de cada índice antes de fusionarlos. */
export const HYBRID_CANDIDATES = 50;

/** Plan de consulta ya armado: los términos extraídos y las cadenas de consulta listas para el índice de palabras (`words`) y el de trigramas (`trigram`); `null` cuando no hay términos que buscar en ese índice. */
export interface QueryPlan { terms: string[]; words: string | null; trigram: string | null }

/** Quita los acentos de un texto (descomponiendo y eliminando las marcas diacríticas) y lo pasa a minúsculas. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Extrae las secuencias de letras y números de un texto ya sin acentos, como lista de palabras. */
function tokens(text: string): string[] {
  return fold(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Extrae las palabras distintas de un texto (sin acentos, en minúsculas) descartando las palabras
 * vacías; si el texto solo tiene palabras vacías, las conserva todas para no quedarse sin términos.
 * @param text Texto de entrada, típicamente lo que escribió la persona en una búsqueda.
 * @returns Lista de palabras distintas y normalizadas, en el orden en que aparecen por primera vez.
 */
export function termsOf(text: string): string[] {
  const all = [...new Set(tokens(text))];
  const meaningful = all.filter(term => !STOPWORDS.has(term));
  return meaningful.length > 0 ? meaningful : all;
}

/**
 * Arma el plan de consulta completo a partir de un texto: extrae los términos (limitados a
 * MAX_QUERY_TERMS), y construye las cadenas de consulta para el índice de palabras y el de trigramas.
 * @param text Texto de búsqueda en lenguaje natural.
 * @returns El plan con los términos y ambas cadenas de consulta (o `null` cuando no aplican).
 */
export function buildQuery(text: string): QueryPlan {
  const terms = termsOf(text).slice(0, MAX_QUERY_TERMS);
  const quote = (term: string) => `"${term}"`;
  // Un término de cuatro o más letras se busca por prefijo (con *); uno más corto, exacto, para no
  // producir demasiados falsos positivos en el índice de palabras.
  const words = terms.length === 0 ? null : terms.map(term => Array.from(term).length >= 4 ? `${quote(term)}*` : quote(term)).join(" OR ");
  // El índice de trigramas conserva los acentos: cada término se busca tanto sin acentos como tal cual se escribió.
  const written = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => terms.includes(fold(word)));
  const long = [...new Set([...terms, ...written])].filter(term => Array.from(term).length >= 3);
  return { terms, words, trigram: long.length === 0 ? null : long.map(quote).join(" OR ") };
}

/**
 * Cuenta cuántos de los términos de una consulta aparecen en un texto: un término de tres o más letras
 * cuenta si aparece como subcadena; uno más corto, solo si aparece como palabra completa.
 * @param terms Términos de la consulta ya planificados (normalizados, sin acentos).
 * @param text Texto del recuerdo a comparar contra los términos.
 * @returns Cuántos de los términos dados aparecen en el texto.
 */
export function matchedTerms(terms: readonly string[], text: string): number {
  const folded = fold(text), words = new Set(tokens(text));
  return terms.filter(term => Array.from(term).length >= 3 ? folded.includes(term) : words.has(term)).length;
}

/** Como máximo se devuelven estos recuerdos similares tras un guardado. */
export const SIMILAR_LIMIT = 3;
/** Proporción mínima de palabras distintas en común que deben tener dos recuerdos para reportarse como similares. */
export const SIMILAR_MIN_SCORE = 0.25;

/**
 * Calcula la similitud de Jaccard (tamaño de la intersección entre el tamaño de la unión) de dos
 * conjuntos de términos, redondeada a dos decimales.
 * @param left Términos del primer recuerdo.
 * @param right Términos del segundo recuerdo.
 * @returns Un número entre 0 y 1; 0 si alguno de los dos conjuntos está vacío.
 */
export function similarity(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left), b = new Set(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const term of a) if (b.has(term)) shared += 1;
  return Math.round(shared / (a.size + b.size - shared) * 100) / 100;
}
