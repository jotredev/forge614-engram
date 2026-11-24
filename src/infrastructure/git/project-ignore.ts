/** Protege el archivo de identidad portátil antes de tocarlo en un árbol de trabajo Git. */
import { accessSync, closeSync, constants, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync,
  realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runProjectGit } from "./project-directory";

const RULE = "/.forge614/";
const DIRECTORY = ".forge614/";
const IDENTITY_FILE = ".forge614/project.json";
const LOCK_WAIT_MS = 2500;
const WAIT = new Int32Array(new SharedArrayBuffer(4));

export type ProjectIgnoreStatus = "ignored" | "tracked" | "unavailable";

function absent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function trackedState(root: string): boolean | null {
  const result = runProjectGit(root, ["ls-files", "--cached", "-z", "--", IDENTITY_FILE]);
  return result?.exitCode === 0 ? result.stdout.length !== 0 : null;
}

/** Consulta el índice sin escribir, para poder avisar al leer una identidad legada rastreada. */
export function isTrackedProjectFile(root: string): boolean {
  return trackedState(root) === true;
}

function excludesIdentity(root: string): boolean {
  const result = runProjectGit(root, ["check-ignore", "--no-index", "--", DIRECTORY, IDENTITY_FILE]);
  if (result?.exitCode !== 0) return false;
  const paths = result.stdout.toString().split(/\r?\n/u);
  return paths.includes(DIRECTORY) && paths.includes(IDENTITY_FILE);
}

type IgnoreFile = { bytes: Buffer; dev: number; ino: number; mode: number };
function inspectIgnore(path: string): IgnoreFile | null {
  try {
    const entry = lstatSync(path);
    if (!entry.isFile()) throw new Error("Expected a regular .gitignore");
    return { bytes: readFileSync(path), dev: entry.dev, ino: entry.ino, mode: entry.mode & 0o777 };
  } catch (error) {
    if (absent(error)) return null;
    throw error;
  }
}

function canonicalLine(line: string): boolean { return line.replace(/[\t \r\n]+$/u, "") === RULE; }

function withCanonicalRule(before: Buffer): Buffer {
  // latin1 permite mover una línea ASCII y conservar byte por byte el resto del contenido.
  const source = before.toString("latin1");
  const lines = source.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  const lastRule = lines.map(canonicalLine).lastIndexOf(true);
  const selected = lastRule < 0 ? RULE : lines.splice(lastRule, 1)[0]!;
  const body = lines.join("");
  const ending = source.match(/\r?\n/u)?.[0] ?? "\n";
  const separator = body !== "" && !body.endsWith("\n") ? ending : "";
  return Buffer.from(`${body}${separator}${selected}${selected.endsWith("\n") ? "" : ending}`, "latin1");
}

function sameFile(before: IgnoreFile, current: IgnoreFile | null): boolean {
  return current !== null && before.dev === current.dev && before.ino === current.ino
    && before.mode === current.mode && before.bytes.equals(current.bytes);
}

function replaceIgnore(path: string, before: IgnoreFile | null, bytes: Buffer): void {
  if (before !== null) {
    if (process.platform !== "win32" && (before.mode & 0o222) === 0) throw new Error("Expected a writable .gitignore");
    accessSync(path, constants.W_OK);
  }
  const temp = `${path}.engram-${crypto.randomUUID()}.tmp`;
  const fd = openSync(temp, "wx", before?.mode ?? 0o644);
  try {
    try {
      writeFileSync(fd, bytes);
      if (before !== null && process.platform !== "win32") fchmodSync(fd, before.mode);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    if (before === null) { linkSync(temp, path); return; }
    if (!sameFile(before, inspectIgnore(path))) throw new Error(".gitignore changed while preparing the update");
    renameSync(temp, path);
  } finally { try { unlinkSync(temp); } catch { /* Puede haber sido renombrado. */ } }
}

function withIgnoreLock<T>(root: string, operation: () => T): T {
  const path = join(root, ".gitignore.engram.lock");
  const deadline = Date.now() + LOCK_WAIT_MS;
  let fd: number;
  for (;;) {
    try { fd = openSync(path, "wx", 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) throw error;
      Atomics.wait(WAIT, 0, 0, 10);
    }
  }
  try { return operation(); }
  finally {
    let owned = false;
    try {
      const ours = fstatSync(fd), current = lstatSync(path);
      owned = ours.dev === current.dev && ours.ino === current.ino;
    } catch { /* El bloqueo pudo desaparecer. */ }
    closeSync(fd);
    if (owned) try { unlinkSync(path); } catch { /* El bloqueo pudo desaparecer al cerrarlo. */ }
  }
}

/** Garantiza la regla anclada de la raíz y comprueba su efecto con Git, sin tocar archivos rastreados. */
export function ensureProjectIgnored(directory: string): ProjectIgnoreStatus {
  try {
    const root = realpathSync(directory);
    const probe = runProjectGit(root, ["rev-parse", "--is-inside-work-tree", "--show-prefix"]);
    if (probe?.exitCode !== 0 || !/^true\r?\n\r?\n$/u.test(probe.stdout.toString())) return "unavailable";
    const tracked = trackedState(root);
    if (tracked === null) return "unavailable";
    if (tracked) return "tracked";
    try { if (!lstatSync(join(root, ".forge614")).isDirectory()) return "unavailable"; }
    catch (error) { if (!absent(error)) return "unavailable"; }

    return withIgnoreLock(root, () => {
      const currentTracked = trackedState(root);
      if (currentTracked === null) return "unavailable";
      if (currentTracked) return "tracked";
      const path = join(root, ".gitignore");
      const before = inspectIgnore(path);
      const hasRule = before?.bytes.toString("latin1").split(/\r?\n/u).some(canonicalLine);
      if (hasRule && excludesIdentity(root)) return "ignored";
      replaceIgnore(path, before, withCanonicalRule(before?.bytes ?? Buffer.alloc(0)));
      return excludesIdentity(root) ? "ignored" : "unavailable";
    });
  } catch { return "unavailable"; }
}
