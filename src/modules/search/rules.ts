/**
 * Reglas de validación de la búsqueda por comando explícito (`memory_search`, no la búsqueda híbrida de
 * `query.ts`): separa la consulta en términos, arma la expresión FTS5 (el motor de texto completo de
 * SQLite) escapando comillas, y valida el límite de resultados. Lo usa
 * `src/infrastructure/sqlite/search.ts`, que si `literal` sale `true` (algún término tiene menos de tres
 * letras, demasiado corto para el índice de trigramas de FTS5) hace un recorrido literal en vez de
 * usar el índice.
 */
import { MemoryError } from "../../shared/errors";
/**
 * Comprueba que un valor sea texto no vacío ni compuesto solo de espacios, y sin caracteres nulos.
 * @param value Valor a validar.
 * @param field Nombre del campo, usado en el mensaje de error.
 * @returns El valor recortado de espacios al inicio y al final.
 * @throws MemoryError con código "INVALID_INPUT" si no es una cadena, está vacío tras recortarlo o contiene un carácter nulo.
 */
function required(value:unknown,field:string):string{if(typeof value!=="string"||!value.trim()||value.includes("\0"))throw new MemoryError("INVALID_INPUT",`El campo ${field} debe ser texto no vacío y sin caracteres nulos.`);return value.trim();}
/**
 * Separa una consulta de búsqueda en términos (por espacios en blanco) y arma la expresión FTS5
 * correspondiente, con cada término entre comillas dobles (escapando las comillas internas) unido con
 * AND. Marca `literal` cuando algún término tiene menos de tres letras, porque el índice de trigramas
 * de FTS5 no indexa términos tan cortos y hace falta un recorrido literal en su lugar.
 * @param query Texto de búsqueda tal como lo escribió quien llama a `memory_search`.
 * @returns Los términos separados, si hace falta modo literal, y la expresión FTS5 lista para usar.
 * @throws MemoryError con código "INVALID_INPUT" si `query` está vacío o contiene un carácter nulo.
 */
export function searchTerms(query:string):{terms:string[];literal:boolean;match:string}{const terms=required(query,"query").split(/\s+/u);return{terms,literal:terms.some(term=>Array.from(term).length<3),match:terms.map(term=>`"${term.replaceAll('"','""')}"`).join(" AND ")};}
/**
 * Comprueba que el límite de resultados de una búsqueda sea un entero seguro entre 1 y 100.
 * @param limit Límite de resultados pedido.
 * @throws MemoryError con código "INVALID_INPUT" si no es un entero seguro, o está fuera de 1 a 100.
 */
export function validateSearchLimit(limit:number):void{if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new MemoryError("INVALID_INPUT","limit debe ser un entero entre 1 y 100.");}
