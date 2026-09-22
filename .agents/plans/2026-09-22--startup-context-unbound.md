# startup-context accepts readable unbound directories — Implementation Plan

**Goal:** Make `startup-context --directory` return its read-only shared context and `project.status: "unbound"` for every existing readable directory that has no resolvable/bound project, including `$HOME` and `/`, without weakening project-binding validation.

**Architecture:** Split directory handling in `src/infrastructure/git/project-directory.ts` into two named stages. A read resolver validates and canonicalizes a real directory and may inspect its Git identity; a bindable-project resolver adds the existing `$HOME` and filesystem-root prohibition. `startup-context` uses the read resolver with `create: false`; every binding and write path continues using the bindable resolver.

**Tech stack:** Bun, TypeScript, SQLite, CLI integration tests.

**Spec:** User-approved task statement, Forge614 Node Standard and minutes 0012, 0013, 0015 (2026-09-22).

## Global Constraints

- Plan lives in `.agents/plans/` as required by the repository procedure; no commit or push is authorized.
- Preserve stdout machine contract: one JSON object with `format: 1`; failures are `{code,error}` only on stderr with exit `1`.
- `startup-context` remains a read-only query: no project, binding, memory, session, database, migration, or file creation.
- Bound project behavior, `ContextResult` sanitation, and the 16,384-byte per-section ceiling remain unchanged.
- Do not mention third-party products in changed public documentation.

## Decisions

1. **Separate resolve from bind.** Introduce a named readable-directory resolver that accepts any existing, readable directory, including `$HOME` and `/`, and a bindable-project resolver that retains the current root/home prohibition. This prevents a read-only query from inheriting write authorization while preserving the anti-accidental-binding guard.
2. **Keep project identity canonical where possible.** The read resolver continues to recognize Git common directories so an already-bound Git project keeps returning its project context. If Git inspection is unavailable or cannot determine an identity, the read resolver falls back to the canonical filesystem directory and returns `unbound`; the bind/write resolver continues to fail closed in that condition.
3. **Do not synthesize fallback state.** No temporary project, binding, database, or memory is created when resolution yields no binding. `unbound` is the complete successful response.
4. **No public contract version bump.** `format: 1` already specifies `unbound`; this repair makes the CLI conform to that published contract. Update the bilingual prose to enumerate readable non-project directories explicitly and recompute only the affected Notion fingerprints.

## Review Focus

1. `$HOME` and `/` must be accepted only by the read path; binding either remains rejected.
2. A non-Git directory must retain shared context and not create any project or binding.
3. A Git directory without an Engram binding, or a readable directory whose Git identity cannot be inspected, must remain `unbound`, rather than producing a synthetic project.
4. A bound Git directory must retain its project context and topic override behavior.
5. Missing, regular-file, and unreadable paths must retain stable safe error JSON and never leak the requested path.

### Task 1: Split read and bind directory resolution

**Files:**
- Modify: `src/infrastructure/git/project-directory.ts`
- Modify: `src/app/project-context.ts`
- Test: `src/infrastructure/git/project-directory.test.ts`

**Interfaces:**
- Produces: `canonicalProjectForRead(directory: string): CanonicalProject`, accepting a real readable directory including `$HOME` and `/`.
- Preserves: `canonicalProject(directory: string): CanonicalProject`, rejecting `$HOME` and filesystem root before any bind/write can occur.
- Consumes: `resolveProjectContext(store, directory, create)` with `create === false` for startup context.

- [ ] **Step 1: Write the failing tests**

```ts
test("read resolution accepts home and filesystem root while bind resolution rejects both", () => {
  expect(canonicalProjectForRead(homedir()).directory).toBe(realpathSync(homedir()));
  expect(canonicalProjectForRead(parse(realpathSync(homedir())).root).directory)
    .toBe(parse(realpathSync(homedir())).root);
  expect(() => canonicalProject(homedir())).toThrow(expect.objectContaining({ code: "INVALID_DIRECTORY" }));
  expect(() => canonicalProject(parse(realpathSync(homedir())).root)).toThrow(expect.objectContaining({ code: "INVALID_DIRECTORY" }));
});
```

- [ ] **Step 2: Verify red**

Run: `bun test src/infrastructure/git/project-directory.test.ts`

Expected: FAIL because `canonicalProjectForRead` is not exported.

- [ ] **Step 3: Implement the minimum split**

```ts
function readableDirectory(directory: string): string {
  if (typeof directory !== "string" || !directory.trim() || directory.includes("\0") || directory.length > 4096) invalidDirectory();
  let canonical: string;
  try {
    canonical = realpathSync(resolve(directory.trim()));
    if (!statSync(canonical).isDirectory()) invalidDirectory();
    accessSync(canonical, constants.R_OK | constants.X_OK);
  } catch { invalidDirectory(); }
  return canonical;
}
function bindableProjectDirectory(directory: string): string {
  const canonical = readableDirectory(directory);
  if (canonical === parse(canonical).root || canonical === realpathSync(homedir())) invalidDirectory();
  return canonical;
}
function canonicalProjectFromDirectory(explicit: string): CanonicalProject {
  const marker = hasGitMarker(explicit);
  const executable = process.env.PATH === undefined ? Bun.which("git") : Bun.which("git", { PATH: process.env.PATH });
  if (!executable) projectIdentityUnavailable();
  const result = Bun.spawnSync([executable, "-C", explicit, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    env: gitEnvironment(), stdout: "pipe", stderr: "pipe", timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_OUTPUT_BYTES, killSignal: "SIGKILL",
  });
  if (result.exitedDueToTimeout || result.exitedDueToMaxBuffer) projectIdentityUnavailable();
  if (result.exitCode !== 0) {
    if (marker || !result.stderr.toString().includes("not a git repository")) projectIdentityUnavailable();
    return { directory: explicit, name: basename(explicit), git: false };
  }
  const output = result.stdout.toString().trim();
  if (!output || output.includes("\0") || !isAbsolute(output)) projectIdentityUnavailable();
  let common: string;
  try { common = realpathSync(output); } catch { projectIdentityUnavailable(); }
  return { directory: common, name: basename(common) === ".git" ? basename(dirname(common)) : basename(common), git: true };
}
export function canonicalProjectForRead(directory: string): CanonicalProject {
  return canonicalProjectFromDirectory(readableDirectory(directory));
}
export function canonicalProject(directory: string): CanonicalProject {
  return canonicalProjectFromDirectory(bindableProjectDirectory(directory));
}
```

Use `canonicalProjectForRead` only in the `create === false` startup-context read route; retain `canonicalProject` in `bindProjectContext`, saves, and session creation.

- [ ] **Step 4: Verify green**

Run: `bun test src/infrastructure/git/project-directory.test.ts src/app/startup-context.test.ts`

Expected: PASS, with existing write/bind semantics unchanged.

### Task 2: Add CLI regression coverage for every outcome

**Files:**
- Modify: `src/interfaces/cli/__tests__/startup-context.e2e.test.ts`

**Interfaces:**
- Consumes: `forge614-engram startup-context --directory <path> --json`.
- Produces: success JSON `{format:1, shared, project:{status:"unbound",projectId:null,context:null}}` for readable unbound directories; safe error JSON for invalid directories.

- [ ] **Step 1: Write the failing CLI tests**

```ts
test("startup-context returns shared favorite-color for a readable non-Git directory without binding it", () => {
  const root = temporary(); const userDirectory = join(root, "user"); const directory = temporary();
  expect(runCli(root, userDirectory, "init", "--json").code).toBe(0);
  expect(runCli(root, userDirectory, "save", "--scope", "shared", "--title", "Favorite color", "--content", "black and purple", "--type", "preference", "--topic", "user/preference/favorite-color").code).toBe(0);
  const result = runCli(root, userDirectory, "startup-context", "--directory", directory, "--json");
  expect(result.code).toBe(0); expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toMatchObject({ format: 1, project: { status: "unbound", projectId: null, context: null } });
  expect(JSON.parse(result.stdout).shared.recent).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Favorite color", topicKey: "user/preference/favorite-color" })]));
  expect(JSON.parse(runCli(root, userDirectory, "project-list").stdout)).toEqual([]);
});

test("startup-context accepts the real home and filesystem root without binding either", () => {
  const root = temporary(); const userDirectory = join(root, "user");
  expect(runCli(root, userDirectory, "init", "--json").code).toBe(0);
  for (const directory of [homedir(), parse(realpathSync(homedir())).root]) {
    const result = runCli(root, userDirectory, "startup-context", "--directory", directory, "--json");
    expect(result.code).toBe(0); expect(JSON.parse(result.stdout).project).toEqual({ status: "unbound", projectId: null, context: null });
  }
});

test("startup-context distinguishes an unbound Git directory from a bound Git directory", () => {
  const root = temporary(); const userDirectory = join(root, "user"); const unbound = temporary(); const bound = temporary();
  expect(runCli(root, userDirectory, "init", "--json").code).toBe(0);
  expect(Bun.spawnSync(["git", "init", unbound], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  expect(Bun.spawnSync(["git", "init", bound], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  const projectId = JSON.parse(runCli(root, userDirectory, "project-create", "--name", "bound").stdout).projectId;
  expect(runCli(root, userDirectory, "project-bind", "--directory", bound, "--project-id", projectId).code).toBe(0);
  expect(JSON.parse(runCli(root, userDirectory, "startup-context", "--directory", unbound, "--json").stdout).project).toEqual({ status: "unbound", projectId: null, context: null });
  expect(JSON.parse(runCli(root, userDirectory, "startup-context", "--directory", bound, "--json").stdout).project).toMatchObject({ status: "bound", projectId });
});
```

- [ ] **Step 2: Verify red**

Run: `bun test src/interfaces/cli/__tests__/startup-context.e2e.test.ts`

Expected: the `$HOME` and `/` cases fail with `INVALID_DIRECTORY`; the other cases characterize the preserved contract.

- [ ] **Step 3: Complete only fixture and assertion wiring needed for Task 1**

Keep the real CLI subprocess, the test-specific user-directory preload, and database state inspection. Do not mock storage, Git, or stdout/stderr.

- [ ] **Step 4: Verify green**

Run: `bun test src/interfaces/cli/__tests__/startup-context.e2e.test.ts`

Expected: PASS; all success cases write JSON only to stdout and all invalid-path cases write JSON only to stderr.

### Task 3: Align bilingual contract prose and fingerprints

**Files:**
- Modify: `docs/es/03-referencia-cli.md`
- Modify: `docs/en/03-cli-reference.md`
- Modify: `docs/es/10-contexto-de-inicio.md`
- Modify: `docs/en/10-startup-context.md`
- Modify: `docs/notion-map.json`

**Interfaces:**
- Consumes: the unchanged `format: 1` CLI contract.
- Produces: documentation that says any existing readable directory may be queried and no Git/binding is required for `unbound`; fingerprints equal the affected document bytes.

- [ ] **Step 1: Edit the contract wording**

State in Spanish and English that `$HOME`, filesystem root, non-Git directories, and unbound Git directories are valid query targets when they exist and are readable; only nonexistent, non-directory, or unreadable targets are invalid. Keep the explicit no-write and 16,384-byte guarantees.

- [ ] **Step 2: Recompute only changed fingerprints**

Run `shasum -a 256 docs/es/03-referencia-cli.md docs/en/03-cli-reference.md docs/es/10-contexto-de-inicio.md docs/en/10-startup-context.md`, then replace the four matching `contentFingerprint` values in `docs/notion-map.json` with `sha256:<digest>`.

- [ ] **Step 3: Verify documentation map**

Run a read-only script that parses `docs/notion-map.json` and compares each affected `contentFingerprint` with `shasum -a 256` output.

Expected: all four fingerprints match and no unrelated entry changes.

### Task 4: Full verification and real CLI evidence

**Files:**
- Modify: `.agents/plans/2026-09-22--startup-context-unbound.md` (append Results only)

- [ ] **Step 1: Run repository verification**

Run: `bun test && bun run typecheck && bun run build`

Expected: exit `0` for each command. If `build` is not declared, record that exact absence and run the repository's documented build command instead without claiming a build passed.

- [ ] **Step 2: Exercise five real CLI cases using a temporary `FORGE614_HOME`**

Seed a temporary SQLite workspace with the shared `user/preference/favorite-color` preference, then record exact exit code, stdout, and stderr for: non-Git directory; home/unbound directory; unbound Git directory; bound Git directory; nonexistent directory. Use the built/current CLI rather than calling application functions.

- [ ] **Step 3: Append Result**

Record root cause with final file:line, changed files, tests, the five CLI outputs, typecheck/test/build output, documentation changes, and `Impacto en el procedimiento de agentes` with a direct Sí/No answer and rationale. Do not commit or publish.

## Result

### Causa raíz

La guarda compartida confundía dos autorizaciones distintas. La implementación anterior en `src/infrastructure/git/project-directory.ts:21` rechazaba `$HOME` y la raíz dentro de `realDirectory()`, antes de que `readStartupContext()` pudiera consultar vínculos. `src/app/startup-context.ts:25` llegaba a esa ruta a través de la resolución de proyecto; por ello una consulta de solo lectura terminaba como `INVALID_DIRECTORY` en vez de `unbound`.

La corrección deja la validación de existencia, tipo y lectura en `readableDirectory()` (`src/infrastructure/git/project-directory.ts:14`) y conserva la prohibición de vincular home o raíz únicamente en `bindableProjectDirectory()` (`:25-29`). `resolveStartupProjectContext()` (`src/app/project-context.ts:21-23`) usa `canonicalProjectForRead()` (`project-directory.ts:94-102`) con `create: false`. Si la identidad Git no puede inspeccionarse, esa función devuelve la identidad de carpeta para lectura; `canonicalProject()` continúa fallando para vínculo y escrituras. El fallback de nombre de raíz en `:83` evita que `/` llegue a la validación de nombre vacío del almacén.

### Archivos tocados

- `.agents/plans/2026-09-22--startup-context-unbound.md`
- `src/infrastructure/git/project-directory.ts`
- `src/app/project-context.ts`
- `src/app/startup-context.ts`
- `src/infrastructure/git/project-directory.test.ts`
- `src/interfaces/cli/__tests__/startup-context.e2e.test.ts`
- `docs/es/03-referencia-cli.md`
- `docs/en/03-cli-reference.md`
- `docs/es/10-contexto-de-inicio.md`
- `docs/en/10-startup-context.md`
- `docs/notion-map.json`

### Pruebas añadidas

- Resolución de lectura para `$HOME` y `/`, con rechazo conservado para la ruta de vínculo.
- Resolución de lectura con Git no disponible: degrada a carpeta no vinculada; el vínculo conserva `PROJECT_IDENTITY_UNAVAILABLE`.
- CLI real: color shared `user/preference/favorite-color` visible desde home y raíz sin vínculo.
- CLI real: repositorio Git no vinculado devuelve `unbound`; el Git vinculado conserva su contexto de proyecto.
- CLI real: ruta ausente, archivo regular y directorio sin permisos devuelven solo `INVALID_DIRECTORY` por stderr.

### Salida real de CLI con SQLite temporal aislado

El repositorio no implementa una ruta de almacenamiento mediante `FORGE614_HOME`; para aislar SQLite se ejecutó la CLI real con `HOME` temporal (y `FORGE614_HOME` temporal presente sin ser consumido), se inicializó la base, se guardó el topic shared de color y se eliminaron los temporales al finalizar.

| Caso | Exit | stdout relevante | stderr |
| --- | ---: | --- | --- |
| carpeta sin Git | 0 | `format: 1`; `shared.recent[0].topicKey: "user/preference/favorite-color"`; `preview: "black and purple"`; `project: {status:"unbound",projectId:null,context:null}` | vacío |
| home temporal | 0 | `format: 1`; mismo shared de color; `project: {status:"unbound",projectId:null,context:null}` | vacío |
| Git sin vínculo | 0 | `format: 1`; mismo shared de color; `project: {status:"unbound",projectId:null,context:null}` | vacío |
| Git vinculado | 0 | `format: 1`; shared de color; `project.status: "bound"`; el contexto contiene `Bound project` y `Favorite color` | vacío |
| ruta inexistente | 1 | vacío | `{"code":"INVALID_DIRECTORY","error":"La carpeta de proyecto no existe, no es válida o no puede usarse como proyecto."}` |

La salida completa de los cuatro casos exitosos preservó también `shared.format: 1`, listas vacías `pinned` y `summaries`, `omitted` en cero y `truncated: false`; el caso vinculado preservó el `projectId` generado y `project.context.format: 1`.

### Verificación

- `bun test`: **443 pass, 10 skip, 0 fail**, 2,193 aserciones, 73 archivos, 27.00 s.
- `bun run typecheck`: exit 0 (`tsc --noEmit`).
- `bun run build`: el `package.json` no declara ese script (`error: Script not found "build"`, exit 1).
- Build documentado ejecutado como sustituto: `bun build ./src/cli.ts --compile --outfile <temporal>/forge614-engram`; compiló 304 módulos y `forge614-engram --version` devolvió `forge614-engram 1.5.0`.
- Comprobación de huellas: las cuatro rutas modificadas coinciden exactamente con `docs/notion-map.json`:
  - `docs/es/03-referencia-cli.md`: `sha256:755d254cdff909cafa288f1c4fb161063b52e2753cbb1385cfa3f79e884d787f`
  - `docs/en/03-cli-reference.md`: `sha256:72c4e232f01e491a3d12f0fc49d64e7ded4f1a2f21c96416650cb6793d024ba9`
  - `docs/es/10-contexto-de-inicio.md`: `sha256:3b45c8bc6c12e85c59dbbad25618a229a0eeebcd80713d431ab3d03c286b01a1`
  - `docs/en/10-startup-context.md`: `sha256:6b0fc2633a81d939a9a8de0c92d8734cf33cb230207f26d89b7076dfa211cff9`

### Documentación y Sincronización en Notion

Se actualizaron las referencias locales 03 y 10 en español e inglés y se sincronizaron vía MCP de Notion en las páginas oficiales preexistentes de `docs/notion-map.json`, sin crear páginas duplicadas.

El contrato de 7 puntos quedó explícito tanto en 03 como en 10 (ES y EN):
1. `startup-context --directory <ruta> --json` es no interactiva, idempotente y de solo lectura.
2. Cualquier directorio existente y legible es válido (`$HOME`, `/`, carpeta sin Git, repo Git sin vínculo y carpeta vinculada).
3. Si no se puede resolver/vincular como proyecto, no falla: devuelve `format: 1`, contexto `shared` normal y `project: { "status": "unbound" }` con los demás valores nulos según esquema (`projectId: null, context: null`).
4. Proyecto válido y vinculado conserva el comportamiento previo (`shared` más contexto de proyecto).
5. Solo fallan ruta inexistente, ruta que no es directorio o ruta ilegible; el fallo produce stdout vacío, stderr JSON `{code,error}` y exit code 1.
6. No crea proyecto, vínculo, recuerdo, sesión, base de datos ni migración.
7. Conserva límites: 16,384 bytes por sección, previews acotados, saneamiento y ausencia de secretos o rutas crudas en errores.

Páginas de Notion actualizadas y verificadas remotamente:
- ES 03: `https://app.notion.com/p/3dd21943d12981ba8803e065eb0938cc?pvs=204` (Sección `startup-context: lectura previa de hosts` corregida y alineada al contrato de 7 puntos; retirados textos truncos y mención no publicada).
- EN 03: `https://app.notion.com/p/3dd21943d129817baeb1fd75514e1a21?pvs=204` (Sección `startup-context: host preload reads` actualizada con el contrato completo).
- ES 10: `https://app.notion.com/p/3e221943d12981f39262dd1bb0790298?pvs=204` (Secciones `Estado`, `Salida y estados`, `Límites y seguridad` y `Errores seguros` actualizadas y alineadas al contrato).
- EN 10: `https://app.notion.com/p/3e221943d12981698538c340d1dc7a85?pvs=204` (Secciones `Status`, `Output and states`, `Limits and safety` y `Safe errors` actualizadas y alineadas al contrato).

Verificación remota: cada página fue consultada con `notion-fetch`, editada con `notion-update-page` y re-consultada inmediatamente confirmando la aplicación exacta del contenido. El hub padre (`https://app.notion.com/p/3dd21943d12981d79156f470e0462780?pvs=204`) fue consultado antes y después, confirmando la lista original de 23 subpáginas sin duplicados.

### Impacto en el procedimiento de agentes

**Sí.** Forge614 Shell debe revalidar su integración de `startup-context`: para un directorio no vinculado debe aceptar exit 0, comprobar `format: 1`, conservar `shared` y tratar `project.status: "unbound"` como ausencia de contexto de proyecto, no como ausencia total de memoria. Otros hosts que hayan tratado cualquier fallo anterior como “sin registros” deben hacer la misma comprobación.

No se hizo commit, tag, push, release ni publicación.
