import { MemoryError } from "../../shared/errors";

const MEMORY_OPTIONS = ["project-id", "scope"];
const OPTIONS: Record<string, readonly string[]> = {
  setup: [], tui: [], init: [], sync: ["upgrade-format"], "sync-watch": ["interval","upgrade-format"], "integration-enable": [], "sessions-enable": [], "reinforcement-enable": [], mcp: [], "assistant-list": [], "memory-hook": ["client"],
  "project-create": ["name"], "project-list": [], "project-rename": ["project-id", "name"], "project-bind": ["directory","project-id"],
  save: [...MEMORY_OPTIONS,"title","content","type","topic","expected-version","request-key","pinned","session-id","session-project-id"],
  search: [...MEMORY_OPTIONS,"query","limit","preview"],
  get: [...MEMORY_OPTIONS,"id","version"], history: [...MEMORY_OPTIONS,"id"],
  archive: [...MEMORY_OPTIONS,"id"], restore: [...MEMORY_OPTIONS,"id"],
  "session-start":["directory","session-id"], "session-end":["project-id","session-id"],
  "session-summary":["project-id","session-id","summary-json","request-key","expected-version"],
  timeline:["project-id","session-id","id","version","before","after"],
  context:["project-id","scope","compact","max-bytes"],
};
const BOOLEAN_FLAGS=new Set(["preview","compact","upgrade-format"]);
export function invalid(message: string): never { throw new MemoryError("INVALID_INPUT",message); }
export function integer(value: string, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!/^\d+$/.test(value)) invalid(`${field} debe ser un entero positivo.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) invalid(`${field} está fuera del rango permitido.`);
  return n;
}
export function nonnegative(value:string,field:string,max:number):number {
  if(!/^\d+$/.test(value)) invalid(`${field} debe ser un entero entre 0 y ${max}.`);
  const n=Number(value);if(!Number.isSafeInteger(n)||n>max)invalid(`${field} está fuera del rango permitido.`);return n;
}

export function parseArguments(args:string[]) {
  const command=args[0] ?? "help";
  if (!Object.hasOwn(OPTIONS,command)) invalid("Comando desconocido. Consulta help.");
  const allowed = new Set(OPTIONS[command]!);
  const values = new Map<string,string>();
  for (let i = 1; i < args.length;) {
    const flag = args[i]!; const key = flag.slice(2); const value = args[i+1];
    if (!flag.startsWith("--") || !allowed.has(key) || values.has(key)) invalid("Opción desconocida o repetida. Consulta help.");
    if(BOOLEAN_FLAGS.has(key)){values.set(key,"true");i+=1;continue;}
    if (!value?.trim() || value.startsWith("--") || value.includes("\0")) invalid("Cada opción necesita un valor no vacío.");
    values.set(key,value.trim());
    i+=2;
  }
  const need = (key: string): string => values.get(key) ?? invalid(`Falta --${key}.`);
  return { command, values, need };
}
export type ParsedCommand = ReturnType<typeof parseArguments>;
