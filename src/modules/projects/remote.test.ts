/**
 * Prueba `normalizeRemote` con un banco de pares de remotos equivalentes y distintos (Review Focus
 * #5), y `matchProjectByRemote` con las combinaciones de coincidencia (ninguna, una, dos) que decide
 * si una carpeta se liga a un proyecto ya conocido.
 */
import { expect, test } from "bun:test";
import { matchProjectByRemote, normalizeRemote } from "./remote";

// Todas estas formas del mismo remoto (https, con ".git", forma scp, ssh://, con puerto explícito, con
// credenciales embebidas, y con protocolo y host en mayúsculas y "/" final) deben normalizar igual.
const EQUIVALENT_REMOTES = [
  "https://github.com/org/repo",
  "https://github.com/org/repo.git",
  "git@github.com:org/repo.git",
  "ssh://git@github.com/org/repo",
  "https://github.com:443/org/repo",
  "https://user:token@github.com/org/repo.git",
  "HTTPS://GitHub.com/org/repo/",
];

// Verifica que las siete formas equivalentes de la lista de arriba normalizan exactamente a la misma cadena.
test("equivalent remote forms (scheme, .git, scp, port, embedded credentials, case) normalize identically", () => {
  const normalized = EQUIVALENT_REMOTES.map(normalizeRemote);
  for (const value of normalized) expect(value).toBe("github.com/org/repo");
});

// Verifica que ninguna forma normalizada conserva credenciales ni el usuario embebido, aunque la entrada los traía.
test("normalized remotes never contain '@' or the embedded credential value", () => {
  for (const value of EQUIVALENT_REMOTES.map(normalizeRemote)) {
    expect(value).not.toContain("@");
    expect(value).not.toContain("token");
  }
});

// Verifica que dos rutas distintas bajo el mismo host no se confunden entre sí.
test("different repository paths under the same host normalize differently", () => {
  expect(normalizeRemote("https://github.com/org/repo")).not.toBe(normalizeRemote("https://github.com/org/repo2"));
});

// Verifica que el mismo dueño y nombre de repositorio bajo hosts distintos no se confunden entre sí.
test("same owner and repo name under different hosts normalize differently", () => {
  expect(normalizeRemote("https://github.com/org/repo")).not.toBe(normalizeRemote("https://gitlab.com/org/repo"));
});

// Verifica que la ruta conserva las mayúsculas: solo el host se pasa a minúsculas, así que dos remotos
// que solo difieren en la mayúscula de la ruta siguen siendo remotos distintos.
test("path casing is preserved, so it still distinguishes otherwise-equal remotes", () => {
  expect(normalizeRemote("https://github.com/Org/Repo")).not.toBe(normalizeRemote("https://github.com/org/repo"));
  expect(normalizeRemote("https://github.com/Org/Repo")).toBe("github.com/Org/Repo");
});

// Verifica que algo sin forma reconocible de remoto (una ruta local, o un texto vacío) se devuelve
// solo recortado, sin inventar una identidad de host/ruta que no tiene.
test("text without remote shape (local path, empty text) is returned only trimmed", () => {
  expect(normalizeRemote("  /Users/dev/project  ")).toBe("/Users/dev/project");
  expect(normalizeRemote("   ")).toBe("");
  expect(normalizeRemote("")).toBe("");
});

// Verifica que, con exactamente un proyecto conocido cuyo remoto (ya normalizado o no) coincide, se
// devuelve su id.
test("matchProjectByRemote returns the single matching project's id", () => {
  const known = [
    { projectId: "p1", origin: "https://github.com/org/repo.git" },
    { projectId: "p2", origin: "https://gitlab.com/org/other" },
  ];
  expect(matchProjectByRemote("git@github.com:org/repo.git", known)).toBe("p1");
});

// Verifica que, sin ningún proyecto conocido cuyo remoto coincida, no se devuelve ninguno (nunca se adivina).
test("matchProjectByRemote returns null when no known project matches", () => {
  const known = [{ projectId: "p1", origin: "https://gitlab.com/org/other" }];
  expect(matchProjectByRemote("https://github.com/org/repo", known)).toBeNull();
});

// Verifica que, con dos proyectos distintos que comparten el mismo remoto, no se devuelve ninguno: la
// ambigüedad nunca se resuelve adivinando cuál de los dos es.
test("matchProjectByRemote returns null when two known projects share the same remote", () => {
  const known = [
    { projectId: "p1", origin: "https://github.com/org/repo" },
    { projectId: "p2", origin: "git@github.com:org/repo.git" },
  ];
  expect(matchProjectByRemote("https://github.com/org/repo.git", known)).toBeNull();
});

// Verifica que un proyecto sin remoto anotado (origin null) nunca participa en la comparación, ni
// siquiera como coincidencia accidental de "null" contra "null".
test("matchProjectByRemote ignores known projects with a null origin", () => {
  const known = [
    { projectId: "p1", origin: null },
    { projectId: "p2", origin: "https://github.com/org/repo" },
  ];
  expect(matchProjectByRemote("https://github.com/org/repo", known)).toBe("p2");
  expect(matchProjectByRemote("https://gitlab.com/org/unrelated", [{ projectId: "p3", origin: null }])).toBeNull();
});
