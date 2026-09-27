/**
 * Lee, crea y actualiza `.forge614/project.json`, el archivo que le da a un repositorio una identidad
 * portátil (un UUID de proyecto y, si aplica, su grupo de ecosistema) independiente de su ruta en disco.
 * Nunca sobrescribe un archivo existente al crearlo (usa un enlace duro o, si el sistema de archivos no lo
 * permite, una comprobación antes de renombrar), nunca cambia los identificadores ya guardados, y rechaza
 * cualquier archivo, carpeta o enlace que no cumpla el esquema o los permisos esperados en vez de
 * corregirlo en silencio. La usan `src/app/project-context.ts` y `src/app/project-identity.ts`.
 */
import type { Stats } from "node:fs";
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { groupName,uuidV4 } from "../../modules/ecosystem";
import { MemoryError } from "../../shared/errors";

const MAX_BYTES = 64 * 1024;

/**
 * Ejecuta una función de validación (que lanza si el valor no cumple) y convierte el resultado en un
 * booleano, para poder usarla dentro de un `.refine()` de zod.
 * @param check Función que lanza si `value` no es válido.
 * @param value Valor a comprobar.
 * @returns `true` si `check` no lanzó; `false` si lanzó cualquier error.
 */
function accepts(check: (value: unknown) => unknown, value: unknown): boolean {
  try { check(value); return true; } catch { return false; }
}

// El esquema de frontera es zod `.strict()` (rechaza campos y versiones de esquema desconocidos), pero zod se
// carga en el primer uso: solo paga ese costo un repositorio que tiene este archivo, nunca la ruta común de arranque.
// `require` mantiene la lectura síncrona; un `import` de nivel superior cargaría zod (y sus locales) en cada comando.
let schema: { safeParse(value: unknown): { success: boolean; data?: unknown } } | null = null;
/**
 * Construye (una sola vez, memorizada en el módulo) el esquema zod que valida la forma exacta de
 * `project.json`: versión de esquema, proyecto con `id` (UUID) y `name` (texto no vacío sin carácter nulo,
 * hasta 300 caracteres) y un ecosistema opcional con `id` (UUID) y `name` (nombre de grupo válido).
 * @returns El esquema zod ya construido, reutilizado en llamadas posteriores.
 */
function projectFileSchema(): NonNullable<typeof schema> {
  if (schema) return schema;
  const { z } = require("zod") as typeof import("zod");
  const uuid = z.string().refine(value => accepts(uuidV4, value));
  const label = z.string().max(300).refine(value => value.trim().length > 0 && !value.includes("\0"));
  const group = z.object({ id: uuid, name: z.string().refine(value => accepts(groupName, value)) }).strict();
  // `ecosystem` puede faltar en un archivo escrito antes de conocerse el grupo; Engram lo completa después.
  schema = z.object({
    schemaVersion: z.literal(1),
    project: z.object({ id: uuid, name: label }).strict(),
    ecosystem: group.nullable().optional(),
  }).strict();
  return schema;
}

/** Identidad de un grupo (ecosistema) tal como se guarda en `project.json`: su UUID y su nombre. */
export interface ProjectFileGroup { id: string; name: string }
/**
 * Forma completa del contenido de `.forge614/project.json`.
 * @property schemaVersion Versión del esquema del archivo; solo existe la `1`.
 * @property project Identidad del proyecto: su UUID y su nombre para mostrar.
 * @property ecosystem Grupo al que pertenece el proyecto, `null` si es un proyecto suelto, o `undefined` si
 * el campo todavía no se ha completado en el archivo.
 */
export interface ProjectFile { schemaVersion: 1; project: { id: string; name: string }; ecosystem?: ProjectFileGroup | null | undefined }
/**
 * Identidad que quien llama quiere que tenga el proyecto, usada como valor de partida al crear el archivo
 * o como referencia al decidir si hay que completarlo.
 * @property projectId UUID que debe tener el proyecto si el archivo se crea desde cero.
 * @property name Nombre que debe tener el proyecto si el archivo se crea desde cero.
 * @property ecosystem Grupo que debe quedar asignado si el archivo se crea desde cero, o se completa un
 * campo `ecosystem` ausente o (con `fillGroup`) explícitamente nulo.
 */
export interface WantedProjectFile { projectId: string; name: string; ecosystem: ProjectFileGroup | null }
/** Resultado de {@link ensureProjectFile}: si el archivo se creó, se completó sin tocar los ids, o ya estaba como se quería. */
export type EnsureStatus = "created" | "completed" | "unchanged";

/**
 * Calcula la ruta del archivo de identidad de un repositorio.
 * @param root Carpeta raíz del repositorio.
 * @returns La ruta `<root>/.forge614/project.json`.
 */
export function projectFilePath(root: string): string { return join(root, ".forge614", "project.json"); }

/**
 * Lanza el error estándar de archivo de identidad inválido, sin haber modificado nada.
 * @throws MemoryError con código `PROJECT_FILE_INVALID` siempre.
 */
function invalid(): never {
  throw new MemoryError("PROJECT_FILE_INVALID", "El archivo .forge614/project.json no es válido; no se modificó. Corrígelo o bórralo para que Engram lo regenere.");
}
/**
 * Obtiene la información de una ruta sin seguir enlaces simbólicos.
 * @param path Ruta a inspeccionar.
 * @returns El resultado de `lstatSync`, o `null` si la ruta no existe.
 * @throws MemoryError con código `PROJECT_FILE_INVALID` (vía {@link invalid}) si `lstat` falla por una
 * razón distinta a que falte la ruta.
 */
function entry(path: string): Stats | null {
  try { return lstatSync(path) ?? null; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; return invalid(); }
}
/**
 * Convierte el contenido de un archivo de identidad a su forma serializada canónica en disco (JSON con
 * sangría de dos espacios y salto de línea final), normalizando `ecosystem` ausente a `null` explícito.
 * @param file Contenido del archivo de identidad a serializar.
 * @returns El texto exacto que debe quedar guardado en `project.json`.
 */
function serialize(file: ProjectFile): string {
  return `${JSON.stringify({ schemaVersion: 1, project: file.project, ecosystem: file.ecosystem === undefined ? null : file.ecosystem }, null, 2)}\n`;
}

/**
 * Lee el archivo de identidad de la raíz de un repositorio.
 * @param root Carpeta raíz del repositorio.
 * @returns El contenido ya validado del archivo, o `null` si el repositorio no tiene carpeta `.forge614`
 * ni archivo `project.json` todavía.
 * @throws MemoryError con código `PROJECT_FILE_INVALID` si `.forge614` o `project.json` son un enlace
 * simbólico, no son del tipo esperado (carpeta o archivo regular), el archivo supera {@link MAX_BYTES}, su
 * contenido no es JSON válido, o no cumple el esquema esperado.
 */
export function readProjectFile(root: string): ProjectFile | null {
  const folder = entry(join(root, ".forge614"));
  if (folder === null) return null;
  if (folder.isSymbolicLink() || !folder.isDirectory()) invalid();
  const path = projectFilePath(root);
  const file = entry(path);
  if (file === null) return null;
  if (file.isSymbolicLink() || !file.isFile() || file.size > MAX_BYTES) invalid();
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, "utf8")); } catch { return invalid(); }
  const parsed = projectFileSchema().safeParse(value);
  if (!parsed.success) invalid();
  return parsed.data as ProjectFile;
}

/**
 * Escribe el contenido dado en un archivo temporal exclusivo dentro de `.forge614` y lo deja listo para
 * publicarse (con los bytes ya confirmados en disco vía `fsync`).
 * @param root Carpeta raíz del repositorio.
 * @param content Contenido a escribir.
 * @returns La ruta del archivo temporal creado.
 */
function temporary(root: string, content: string): string {
  const path = join(root, ".forge614", `.project.json.tmp-${crypto.randomUUID()}`);
  const fd = openSync(path, "wx", 0o644);
  try { writeSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
  return path;
}
/**
 * Publica un contenido nuevo sobre `project.json`, reemplazando lo que hubiera antes; si el renombrado
 * falla, intenta limpiar el archivo temporal y propaga el error original sin dejar el archivo a medias.
 * @param root Carpeta raíz del repositorio.
 * @param content Contenido nuevo a publicar.
 * @throws El error original de `renameSync` si el renombrado falla.
 */
function replace(root: string, content: string): void {
  const source = temporary(root, content);
  try { renameSync(source, projectFilePath(root)); }
  catch (error) { try { unlinkSync(source); } catch { /* Conserva el material recuperable si la limpieza falla. */ } throw error; }
}
/**
 * Publica un archivo nuevo sin reemplazar nunca uno que otro escritor haya creado primero: intenta un
 * enlace duro (falla con `EEXIST` si ya existe el destino); si el sistema de archivos no soporta enlaces
 * duros ahí, recurre a comprobar que el destino sigue sin existir justo antes de renombrar.
 * @param root Carpeta raíz del repositorio (se crea `.forge614` si falta).
 * @param content Contenido a publicar.
 * @returns `true` si este llamado publicó el archivo; `false` si ya existía uno (ganó otro escritor).
 */
function create(root: string, content: string): boolean {
  mkdirSync(join(root, ".forge614"), { recursive: true, mode: 0o755 });
  const source = temporary(root, content);
  try {
    try { linkSync(source, projectFilePath(root)); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      // Los enlaces duros pueden no estar disponibles en algunos sistemas de archivos; se recurre a un renombrado comprobado.
      if (entry(projectFilePath(root)) !== null) return false;
      renameSync(source, projectFilePath(root)); return true;
    }
  } finally { try { unlinkSync(source); } catch { /* Ya se renombró, o se conservó a propósito. */ } }
}

/**
 * Asegura que el repositorio tiene un archivo de identidad con los datos deseados, de forma silenciosa e
 * idempotente: si no existe, lo crea; si existe, nunca cambia sus identificadores (`id` de proyecto o de
 * grupo) ni su nombre, y solo completa el campo `ecosystem` cuando falta del todo, o cuando es
 * explícitamente `null` y quien llama pasó `fillGroup: true` con un grupo deseado no nulo.
 * @param root Carpeta raíz del repositorio.
 * @param wanted Identidad deseada si el archivo se crea desde cero, o valor de referencia para completar
 * un campo `ecosystem` ausente o nulo.
 * @param options.fillGroup Si es `true`, permite completar también un `ecosystem` explícitamente `null`
 * (no solo uno ausente).
 * @returns El estado de la operación ({@link EnsureStatus}) y el contenido final del archivo.
 * @throws MemoryError con código `PROJECT_FILE_INVALID` si el archivo existente o el creado por otro
 * escritor concurrente no se puede leer.
 */
export function ensureProjectFile(root: string, wanted: WantedProjectFile, options: { fillGroup?: boolean } = {}): { status: EnsureStatus; file: ProjectFile } {
  const existing = readProjectFile(root);
  if (existing === null) {
    const file: ProjectFile = { schemaVersion: 1, project: { id: wanted.projectId, name: wanted.name }, ecosystem: wanted.ecosystem };
    if (create(root, serialize(file))) return { status: "created", file };
    const winner = readProjectFile(root);
    if (winner === null) return invalid();
    return { status: "unchanged", file: winner };
  }
  const fill = existing.ecosystem === undefined || (existing.ecosystem === null && options.fillGroup === true && wanted.ecosystem !== null);
  if (!fill) return { status: "unchanged", file: existing };
  const file: ProjectFile = { ...existing, ecosystem: wanted.ecosystem };
  replace(root, serialize(file));
  return { status: "completed", file };
}

/**
 * Cambia el nombre o el grupo del proyecto, sin tocar nunca sus identificadores; si el resultado
 * serializado es idéntico al actual, no escribe nada.
 * @param root Carpeta raíz del repositorio.
 * @param patch Campos a cambiar; los que se omiten conservan su valor actual (`ecosystem: undefined`
 * significa «no tocar», a diferencia de `null`, que sí se aplica).
 * @returns El archivo con el parche aplicado, o `null` si el repositorio todavía no tiene archivo de
 * identidad.
 * @throws MemoryError con código `PROJECT_FILE_INVALID` si el archivo existente no se puede leer.
 */
export function updateProjectFile(root: string, patch: { name?: string; ecosystem?: ProjectFileGroup | null }): ProjectFile | null {
  const existing = readProjectFile(root);
  if (existing === null) return null;
  const next: ProjectFile = {
    schemaVersion: 1,
    project: { id: existing.project.id, name: patch.name ?? existing.project.name },
    ecosystem: patch.ecosystem === undefined ? existing.ecosystem : patch.ecosystem,
  };
  if (serialize(next) !== serialize(existing)) replace(root, serialize(next));
  return next;
}
