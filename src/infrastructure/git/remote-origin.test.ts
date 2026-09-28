/**
 * Prueba `readOriginRemote`: lee la url del remoto `origin` directamente del archivo `config` de
 * Git, tolera comentarios y tabulaciones, y no resuelve `include` ni otras secciones sin ser "origin".
 */
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readOriginRemote } from "./remote-origin";
import { withDirectory } from "../__test-support__/fixtures";

// Escribe el texto dado como el archivo config del directorio común de Git de la prueba.
const writeConfig = (directory: string, text: string): void => writeFileSync(join(directory, "config"), text);

// Verifica el caso normal: una sección [remote "origin"] con su línea url se lee tal cual.
test("reads the url from [remote \"origin\"]", () => withDirectory(dir => {
  writeConfig(dir, '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/org/repo.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n');
  expect(readOriginRemote(dir)).toBe("https://github.com/org/repo.git");
}));

// Verifica que un remoto con otro nombre (no "origin") no cuenta: sin una sección [remote "origin"], no hay url que leer.
test("returns null when other remotes exist but none is named \"origin\"", () => withDirectory(dir => {
  writeConfig(dir, '[remote "upstream"]\n\turl = https://github.com/org/upstream.git\n');
  expect(readOriginRemote(dir)).toBeNull();
}));

// Verifica que, sin archivo config en absoluto, se devuelve null en vez de lanzar.
test("returns null when the config file does not exist", () => withDirectory(dir => {
  expect(readOriginRemote(dir)).toBeNull();
}));

// Verifica que se toleran comentarios (# y ;) y tabuladores de indentación alrededor de la línea url.
test("tolerates comments and tabs around the url line", () => withDirectory(dir => {
  writeConfig(dir, '[remote "origin"]\n\t; comentario antes de la url\n\turl = https://github.com/org/repo.git # comentario al final\n');
  expect(readOriginRemote(dir)).toBe("https://github.com/org/repo.git");
}));

// Verifica que una directiva include no se sigue: solo cuenta lo que está escrito en este mismo archivo.
test("does not resolve include: only reads what is directly in this file", () => withDirectory(dir => {
  writeConfig(dir, '[include]\n\tpath = ../other.gitconfig\n[remote "origin"]\n\turl = https://github.com/org/repo.git\n');
  expect(readOriginRemote(dir)).toBe("https://github.com/org/repo.git");
}));
