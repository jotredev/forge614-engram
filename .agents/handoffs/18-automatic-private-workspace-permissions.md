# Handoff técnico 18: Reparación automática de permisos del espacio privado de trabajo

Fecha de verificación: 2026-09-19 (UTC).  
Rama: `feat/automatic-private-workspace-permissions`.  
Commit de implementación verificado: `5a1505780df37ef6d9e017ab00c95d73bce36687` (`fix: repair owned workspace permissions during setup`).

---

## 1. Resumen y Comportamiento Entregado

Forge614 Engram almacena recuerdos del usuario, bases de datos locales SQLite (`engram.db`), diarios WAL y credenciales opcionales de sincronización con PostgreSQL en su carpeta central `~/.forge614/`.

Para garantizar que ningún otro usuario local del sistema operativo pueda leer o modificar esta información, el espacio de trabajo debe tener permisos octales estrictos POSIX `0700` (`rwx------`, acceso exclusivo del propietario de la cuenta).

Anteriormente, si la carpeta `~/.forge614/` ya existía con permisos más abiertos (por ejemplo `0755` creado por el usuario o por herramientas externas), el sistema fallaba con el error `CONFIG_INVALID` y exigía que el usuario ejecutara manualmente `chmod 0700 ~/.forge614`.

### Comportamiento implementado en commit 5a15057

1. **Reparación automática sin intervención manual:** Tanto el asistente interactivo `forge614-engram setup` como el comando de inicialización `forge614-engram init` y el método `MemoryWorkspace.init()` reparan automáticamente una carpeta existente propiedad del usuario restringiendo sus permisos a `0700`.
2. **Los usuarios no necesitan conocer ni ejecutar `chmod`:** La experiencia de incorporación elimina fricciones técnicas y evita errores de permisos en entornos de usuario estándar.
3. **Semántica de cancelación intacta:** `setup` ejecuta la reparación de permisos del directorio existente antes de leer la configuración o formular preguntas interactivas. Si el usuario cancela inmediatamente o en cualquier paso subsiguiente, **no se crean `.env`, `engram.db`, proyectos ni recuerdos**; únicamente se habrán asegurado los permisos de privacidad del directorio existente.
4. **Límites estrictos de seguridad (*Fail-Closed*):**
   - La reparación actúa **únicamente** sobre directorios ordinarios ya existentes que pertenezcan al usuario actual (`stat.uid === process.getuid()`).
   - Si el directorio no existe, los métodos de comprobación o reparación (`repairExistingRoot()`) **no lo crean**; la creación solo ocurre en `prepare()`.
   - **Jamás repara ni sigue enlaces simbólicos (*symlinks*).**
   - Rechaza y bloquea de inmediato rutas que no sean directorios, enlaces simbólicos, carpetas propiedad de otro usuario o directorios cuyos permisos finales no puedan restringirse a `0700`.

---

## 2. Archivos Modificados y Cambios de Código

### `src/infrastructure/filesystem/workspace-config.ts`

- **Funciones auxiliares de propiedad:**
  ```typescript
  function ownedByCurrentUser(stat: Stats): boolean {
    return typeof process.getuid !== "function" || stat.uid === process.getuid();
  }
  function privateOwned(stat: Stats): boolean {
    return (stat.mode & 0o077) === 0 && ownedByCurrentUser(stat);
  }
  ```
- **Nuevo método público `repairExistingRoot()`:**
  ```typescript
  /** Tighten only an existing ordinary user-owned directory; never creates one. */
  repairExistingRoot(): void { this.directory(false, true); }
  ```
- **Firma y lógica ampliada en `directory(create: boolean, repair: boolean): boolean`:**
  - Si `create` es verdadero, mantiene la creación con `mkdirSync(this.root, { recursive: true, mode: 0o700 })`.
  - Obtiene los metadatos con `lstatSync(this.root)` sin seguir enlaces simbólicos.
  - Verifica que sea un directorio ordinario, no un symlink y que pertenezca al usuario actual (`ownedByCurrentUser`). Si alguna condición falla, arroja `failure()`.
  - Si `repair` es verdadero y los bits de grupo u otros están abiertos (`(stat.mode & 0o077) !== 0`), ejecuta `chmodSync(this.root, 0o700)`.
  - Realiza una re-verificación con `lstatSync(this.root)` para certificar que el estado resultante sea un directorio ordinario, no un symlink y estrictamente `privateOwned`.
  - Si `!create` y el error es `ENOENT`, retorna `false` limpiamente sin fallar.
- **Llamadas adaptadas:**
  - `prepare()` ahora ejecuta `this.directory(true, true)` (crea si no existe con 0700 y repara si ya existía con permisos abiertos).
  - `exists()` y `read()` utilizan `this.directory(false, false)` para inspeccionar sin mutar permisos en lecturas rutinarias.

### `src/app/setup.ts`

- Al iniciar `runSetup()`, antes de inspeccionar `config.exists()` o desplegar preguntas:
  ```typescript
  config.repairExistingRoot();
  ```
- Esto garantiza que si la carpeta `~/.forge614/` existía con `0755`, se restringe a `0700` inmediatamente, permitiendo que la lectura de configuración funcione sin requerir `chmod` previo.
- Si el usuario cancela en la primera pregunta (escribiendo `q`, `cancelar` o pulsando `Ctrl+C`), el flujo retorna `{ cancelled: true }` y no escribe `.env` ni `engram.db`.

### `src/app/workspace.ts`

- En `MemoryWorkspace.init()`:
  ```typescript
  init(): void {
    this.config.repairExistingRoot();
    if (this.config.exists()) {
      const store = this.open(true);
      store.close();
      return;
    }
    this.config.prepare();
    ...
  }
  ```
- Asegura que cualquier inicialización programática o por CLI (`forge614-engram init`) sanee los permisos de la carpeta si ya existía abierta.

### `src/app/setup.test.ts`

- Nueva prueba de regresión:
  ```typescript
  test("setup automatically restricts an existing user-owned workspace directory before prompting", async () => {
    const { config } = fixture();
    mkdirSync(config.root, { mode: 0o755 });
    chmodSync(config.root, 0o755);

    expect(await runSetup(conversation(["q"]).io, config)).toEqual({ cancelled: true });

    expect(statSync(config.root).mode & 0o777).toBe(0o700);
    expect(existsSync(join(config.root, ".env"))).toBe(false);
    expect(existsSync(config.databasePath)).toBe(false);
  });
  ```

---

## 3. Matriz de Comportamiento y Seguridad

| Estado de la ruta `~/.forge614` | Propietario | Permisos iniciales | Acción en `repairExistingRoot()` | Resultado final |
| :--- | :--- | :--- | :--- | :--- |
| Inexistente (`ENOENT`) | N/A | N/A | Ninguna (no crea carpetas) | Retorna `false`; `setup` o `init` la crea con `0700` si continúa |
| Directorio normal | Usuario actual | `0700` | Ninguna (ya es privado) | Aceptado (`0700`) |
| Directorio normal | Usuario actual | `0755` o `0777` | Ejecuta `chmodSync(..., 0o700)` | Reparado exitosamente a `0700` |
| Enlace simbólico (*symlink*) | Cualquiera | Cualquiera | Rechazado de inmediato | Error `CONFIG_INVALID` (*fail-closed*) |
| Archivo regular / FIFO / socket | Cualquiera | Cualquiera | Rechazado de inmediato | Error `CONFIG_INVALID` (*fail-closed*) |
| Directorio | Otro usuario (root / ajeno) | Cualquiera | Rechazado de inmediato | Error `CONFIG_INVALID` (*fail-closed*) |
| Directorio en sistema de solo lectura | Usuario actual | `0755` | `chmodSync` falla | Error `CONFIG_INVALID` (*fail-closed*) |

---

## 4. Evidencia de Validación

1. **Prueba de regresión TDD:** La prueba falló antes del cambio (arrojando `CONFIG_INVALID` en lugar de reparar) y pasó exitosamente tras la implementación.
2. **Suite enfocada:**
   ```bash
   bun test src/app/setup.test.ts src/infrastructure/filesystem/workspace-config.test.ts
   # 18 pass, 0 fail, 136 expect() calls (76ms)
   ```
3. **Suite completa de pruebas:**
   ```bash
   bun test
   # 545 pass, 15 skip, 0 fail, 2671 expect() calls en 88 archivos (34.77s)
   ```
4. **Comprobación de tipos estáticos:**
   ```bash
   bun run typecheck
   # tsc --noEmit: código 0
   ```
5. **Verificación de estilo y espacios:**
   ```bash
   git diff --check
   # código 0 (sin advertencias de espacios)
   ```
