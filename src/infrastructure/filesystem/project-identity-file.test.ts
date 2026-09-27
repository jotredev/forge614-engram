/** Comprueba que `project.json` se crea, completa y actualiza sin tocar sus ids, y que rechaza cualquier forma inválida o insegura sin sobrescribirla. */
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureProjectFile, projectFilePath, readProjectFile, updateProjectFile } from "./project-identity-file";

const roots: string[] = [];
function repository(): string { const root = mkdtempSync(join(tmpdir(), "engram-identity-")); roots.push(root); return root; }
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const wanted = () => ({ projectId: crypto.randomUUID(), name: "frontend", ecosystem: null });
const write = (root: string, content: string) => { mkdirSync(join(root, ".forge614"), { recursive: true }); writeFileSync(projectFilePath(root), content); };

// Sin archivo previo, la lectura debe dar null y la creación debe quedar completa y legible de vuelta tal cual se pidió.
test("a missing file reads as null and creating it is silent, complete and readable back", () => {
  const root = repository();
  expect(readProjectFile(root)).toBeNull();
  const group = { id: crypto.randomUUID(), name: "tienda" };
  const input = { projectId: crypto.randomUUID(), name: "frontend", ecosystem: group };
  const created = ensureProjectFile(root, input);
  expect(created.status).toBe("created");
  expect(readProjectFile(root)).toEqual({ schemaVersion: 1, project: { id: input.projectId, name: "frontend" }, ecosystem: group });
  expect(readFileSync(projectFilePath(root), "utf8")).toBe(`${JSON.stringify({ schemaVersion: 1, project: { id: input.projectId, name: "frontend" }, ecosystem: group }, null, 2)}\n`);
});

// Un proyecto sin grupo debe guardar `ecosystem` como `null` explícito, no omitirlo.
test("a loose project is written with an explicit null ecosystem", () => {
  const root = repository(); const input = wanted();
  ensureProjectFile(root, input);
  expect(JSON.parse(readFileSync(projectFilePath(root), "utf8"))).toEqual({ schemaVersion: 1, project: { id: input.projectId, name: "frontend" }, ecosystem: null });
});

// Repetir la operación no debe cambiar el archivo ni sus identificadores, aunque se pida otro nombre.
test("repeating the write changes nothing and never replaces the ids", () => {
  const root = repository(); const first = wanted();
  ensureProjectFile(root, first);
  const digest = sha(projectFilePath(root));
  expect(ensureProjectFile(root, first).status).toBe("unchanged");
  const other = { ...wanted(), name: "otro" };
  expect(ensureProjectFile(root, other)).toMatchObject({ status: "unchanged", file: { project: { id: first.projectId } } });
  expect(sha(projectFilePath(root))).toBe(digest);
});

// Un archivo existente al que solo le falta `ecosystem` debe completarse sin tocar el id ni el nombre ya guardados.
test("an existing file missing only the ecosystem field is completed without touching the ids", () => {
  const root = repository(); const id = crypto.randomUUID();
  write(root, JSON.stringify({ schemaVersion: 1, project: { id, name: "clon" } }));
  const result = ensureProjectFile(root, { projectId: id, name: "ignorado", ecosystem: null });
  expect(result.status).toBe("completed");
  expect(readProjectFile(root)).toEqual({ schemaVersion: 1, project: { id, name: "clon" }, ecosystem: null });
});

// Un `ecosystem` guardado como `null` explícito solo debe completarse si quien llama lo permite con `fillGroup`.
test("an explicit null ecosystem is only filled when the caller allows it", () => {
  const root = repository(); const input = wanted(); const group = { id: crypto.randomUUID(), name: "tienda" };
  ensureProjectFile(root, input);
  expect(ensureProjectFile(root, { ...input, ecosystem: group }).status).toBe("unchanged");
  expect(ensureProjectFile(root, { ...input, ecosystem: group }, { fillGroup: true }).status).toBe("completed");
  expect(readProjectFile(root)?.ecosystem).toEqual(group);
});

// Cada forma inválida del archivo (JSON roto, versión desconocida, campos extra, id no UUID, nombre vacío o mal formado) debe rechazarse sin modificar el archivo original.
test.each([
  ["not json", "{"],
  ["a JSON array", "[]"],
  ["an unknown schema version", JSON.stringify({ schemaVersion: 2, project: { id: crypto.randomUUID(), name: "x" }, ecosystem: null })],
  ["unknown extra fields", JSON.stringify({ schemaVersion: 1, project: { id: crypto.randomUUID(), name: "x" }, ecosystem: null, extra: true })],
  ["extra project fields", JSON.stringify({ schemaVersion: 1, project: { id: crypto.randomUUID(), name: "x", path: "/a" }, ecosystem: null })],
  ["a project id that is not a UUID", JSON.stringify({ schemaVersion: 1, project: { id: "frontend", name: "x" }, ecosystem: null })],
  ["an empty project name", JSON.stringify({ schemaVersion: 1, project: { id: crypto.randomUUID(), name: " " }, ecosystem: null })],
  ["a group name that breaks the pattern", JSON.stringify({ schemaVersion: 1, project: { id: crypto.randomUUID(), name: "x" }, ecosystem: { id: crypto.randomUUID(), name: "Mala Marca" } })],
  ["an empty file", ""],
])("%s is refused as PROJECT_FILE_INVALID and never overwritten", (_label, content) => {
  const root = repository(); write(root, content);
  expect(() => readProjectFile(root)).toThrow(expect.objectContaining({ code: "PROJECT_FILE_INVALID" }));
  expect(() => ensureProjectFile(root, wanted())).toThrow(expect.objectContaining({ code: "PROJECT_FILE_INVALID" }));
  expect(() => updateProjectFile(root, { name: "nuevo" })).toThrow(expect.objectContaining({ code: "PROJECT_FILE_INVALID" }));
  expect(readFileSync(projectFilePath(root), "utf8")).toBe(content);
});

// Una carpeta, un enlace simbólico o un archivo demasiado grande en el lugar del archivo de identidad deben rechazarse sin seguirlos ni leerlos.
test("a directory, a symbolic link or an oversized file in its place is refused", () => {
  const directory = repository(); mkdirSync(projectFilePath(directory), { recursive: true });
  expect(() => readProjectFile(directory)).toThrow(expect.objectContaining({ code: "PROJECT_FILE_INVALID" }));
  const linked = repository(); const target = join(repository(), "elsewhere.json");
  writeFileSync(target, JSON.stringify({ schemaVersion: 1, project: { id: crypto.randomUUID(), name: "x" }, ecosystem: null }));
  mkdirSync(join(linked, ".forge614")); symlinkSync(target, projectFilePath(linked));
  expect(() => readProjectFile(linked)).toThrow(expect.objectContaining({ code: "PROJECT_FILE_INVALID" }));
  expect(() => ensureProjectFile(linked, wanted())).toThrow(expect.objectContaining({ code: "PROJECT_FILE_INVALID" }));
  const big = repository(); write(big, " ".repeat(70_000));
  expect(() => readProjectFile(big)).toThrow(expect.objectContaining({ code: "PROJECT_FILE_INVALID" }));
  const folder = repository(); const outside = repository(); symlinkSync(outside, join(folder, ".forge614"));
  expect(() => ensureProjectFile(folder, wanted())).toThrow(expect.objectContaining({ code: "PROJECT_FILE_INVALID" }));
  expect(existsSync(join(outside, "project.json"))).toBe(false);
});

// Renombrar el proyecto o cambiar su grupo debe conservar los identificadores y no dejar archivos temporales sueltos.
test("renames and group changes keep the identifiers and leave no temporary files behind", () => {
  const root = repository(); const input = wanted(); const group = { id: crypto.randomUUID(), name: "tienda" };
  ensureProjectFile(root, input);
  expect(updateProjectFile(root, { name: "nuevo-nombre" })!.project).toEqual({ id: input.projectId, name: "nuevo-nombre" });
  expect(updateProjectFile(root, { ecosystem: group })!.ecosystem).toEqual(group);
  expect(updateProjectFile(root, { ecosystem: { id: group.id, name: "mi-tienda" } })!.ecosystem).toEqual({ id: group.id, name: "mi-tienda" });
  expect(updateProjectFile(root, { ecosystem: null })!.ecosystem).toBeNull();
  expect(readProjectFile(root)?.project.id).toBe(input.projectId);
  expect(readdirSync(join(root, ".forge614"))).toEqual(["project.json"]);
});

// Escribir el archivo de identidad no debe tocar ningún otro archivo que ya viva dentro de `.forge614`.
test("nothing else inside .forge614 is ever touched", () => {
  const root = repository(); mkdirSync(join(root, ".forge614"));
  writeFileSync(join(root, ".forge614", "lock.json"), "{\"hub\":true}");
  ensureProjectFile(root, wanted());
  expect(readFileSync(join(root, ".forge614", "lock.json"), "utf8")).toBe("{\"hub\":true}");
  expect(readdirSync(join(root, ".forge614")).sort()).toEqual(["lock.json", "project.json"]);
});
