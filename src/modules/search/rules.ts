import { MemoryError } from "../../shared/errors";
function required(value:unknown,field:string):string{if(typeof value!=="string"||!value.trim()||value.includes("\0"))throw new MemoryError("INVALID_INPUT",`El campo ${field} debe ser texto no vacío y sin caracteres nulos.`);return value.trim();}
export function searchTerms(query:string):{terms:string[];literal:boolean;match:string}{const terms=required(query,"query").split(/\s+/u);return{terms,literal:terms.some(term=>Array.from(term).length<3),match:terms.map(term=>`"${term.replaceAll('"','""')}"`).join(" AND ")};}
export function validateSearchLimit(limit:number):void{if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new MemoryError("INVALID_INPUT","limit debe ser un entero entre 1 y 100.");}
