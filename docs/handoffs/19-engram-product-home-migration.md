# Handoff técnico 19: Hogar propio de producto, migración segura y desinstalador coordinado (v1.1.0-beta.1)

Fecha de verificación: 2026-09-19 (UTC).  
Rama: `feat/engram-product-home-migration`.  
Versión candidata: 1.1.0-beta.1.  
Commits clave de la entrega:
- `c5f4c12`: `feat: define the Engram product home`
- `c3f4843`: `feat: migrate legacy Engram storage safely`
- `be1177f`: `fix: report the Engram product-home paths`
- `b4479e0`: `feat: install Engram inside its product home`
- `629ef33`: `feat: plan safe removal of Engram assistant integrations`
- `dafcd7a`: `feat: add guarded Engram uninstall`
- `d447c69`: `feat: complete guarded Engram uninstall`
- `422ed65`: `chore: prepare version 1.1.0`
- `0cb7d00`: `fix: remove escaped Engram PATH entries`

---

## 1. Resumen y Comportamiento Entregado

La versión 1.1.0 de Forge614 Engram introduce una transformación arquitectónica fundamental en la gestión del sistema de archivos, el ciclo de vida del producto dentro de la suite Forge614 y la capacidad de desinstalación quirúrgica:

1. **Hogar Propio de Producto (`~/.forge614/engram/`):**
   - Engram deja de almacenar sus archivos directamente en la raíz `~/.forge614/`.
   - Ahora reside en su propio subdirectorio exclusivo `~/.forge614/engram/`, conviviendo en armonía con otros productos de la suite como `~/.forge614/shell/` y `~/.forge614/atlas/`.
   - Los binarios ejecutables se alojan en `~/.forge614/engram/bin/forge614-engram` (o `forge614-engram.exe` en Windows).
   - Los archivos de configuración y base de datos se alojan en `~/.forge614/engram/.env` y `~/.forge614/engram/engram.db`.
   - Engram jamás lee, modifica ni elimina el contenido de `shell/`, `atlas/` ni otros archivos fuera de `engram/`.

2. **Migración Segura, Automática y Atómica de Espacios Legados (`EngramProductHome.migrateLegacyWorkspace`):**
   - Cuando Engram detecta un espacio de trabajo previo directamente en `~/.forge614/` sin la carpeta `engram/`, migra de forma automática y atómica únicamente los 5 archivos exactos de Engram:
     1. `.env`
     2. `engram.db`
     3. `engram.db-wal`
     4. `engram.db-shm`
     5. `.config-lock`
   - Si ocurre cualquier error de E/S durante el traslado, el sistema revierte atómicamente todos los archivos ya movidos a su ubicación original antes de fallar con `LEGACY_MIGRATION_FAILED`.
   - Falla cerrada de seguridad: Si la raíz o cualquiera de los archivos legados es un enlace simbólico (*symlink*) o pertenece a otro usuario, aborta con `LEGACY_UNSAFE`. Si hay conflicto de archivos existentes o diarios WAL/SHM huérfanos sin base principal, aborta con `LEGACY_CONFLICT`.

3. **Reparación Automática de Permisos (`repairExistingRoot`):**
   - Durante la inicialización o configuración, Engram protege solamente su directorio `~/.forge614/engram` con `0700` (`rwx------`). El contenedor compartido `~/.forge614` se valida y debe ser seguro, pero Engram no cambia sus permisos ni los de productos hermanos.

4. **Desinstalador Quirúrgico Coordinado (`forge614-engram uninstall`):**
   - Retira de forma completa, limpia y segura la instalación de Engram del sistema operativo.
   - Requiere confirmación obligatoria mediante la opción `--confirm <frase>`.
   - **Confirmación de doble nivel según presencia de Atlas:**
     - Si Engram está solo: `--confirm "REMOVE FORGE614-ENGRAM"`.
     - Si Atlas está instalado (`~/.forge614/atlas/`): `--confirm "REMOVE FORGE614-ENGRAM AND FORGE614-ATLAS"`. Cualquier intento de usar la frase simple aborta con `ATLAS_UNINSTALL_REQUIRED`.
   - **Coordinación previa de Atlas:** Invoca de forma sincronizada `~/.forge614/atlas/bin/forge614-atlas uninstall --from forge614-engram --confirmed`. Si el binario falta o el proceso falla, Engram se detiene inmediatamente con `ATLAS_UNINSTALL_REQUIRED` o `ATLAS_UNINSTALL_FAILED`, protegiendo la integridad del sistema.
   - **Retirada quirúrgica en asistentes:** Limpia las configuraciones MCP y ganchos gestionados en Claude Code, Codex, Cursor, OpenCode y Antigravity sin tocar ajustes de otros productos o herramientas personales.
   - **Limpieza quirúrgica de PATH:** Retira limpiamente los bloques de exportación en dotfiles Unix (`.zshrc`, `.bashrc`, `.bash_profile`, `config.fish`) y entradas en el Registro de Windows User PATH. Si el bloque fue modificado a mano, aborta con `PATH_CONFLICT`.
   - **Confinamiento de borrado:** Elimina exclusivamente el directorio `~/.forge614/engram/`. Si la carpeta padre `~/.forge614/` contiene otros productos (`shell/`, `atlas/`) o archivos ajenos, la carpeta padre se mantiene intacta.

---

## 2. Archivos Modificados e Implementaciones Principales

### 1. `src/infrastructure/filesystem/product-home.ts`
- Implementa la clase `EngramProductHome` responsable de calcular las rutas oficiales de Engram:
  - `homeDirectory`: `~/.forge614/engram/`
  - `binDirectory`: `~/.forge614/engram/bin/`
  - `binaryPath`: `~/.forge614/engram/bin/forge614-engram[.exe]`
  - `databasePath`: `~/.forge614/engram/engram.db`
  - `envPath`: `~/.forge614/engram/.env`
- Contiene el método `migrateLegacyWorkspace()` que orquesta la inspección, validación y traslado atómico con reversión ante fallos.

### 2. `src/app/uninstall.ts`
- Orquesta el comando `forge614-engram uninstall`:
  - Valida la frase de confirmación estricta (`--confirm`).
  - Detecta la presencia de `~/.forge614/atlas/`.
  - Invoca el desinstalador de Atlas si corresponde.
  - Ejecuta la retirada segura de ganchos y bloques MCP exactos en los 5 asistentes soportados.
  - Retira las entradas de PATH exactas creadas por el instalador.
  - Elimina únicamente el directorio `~/.forge614/engram/`; nunca elimina la raíz familiar `~/.forge614/`.

### 3. `src/infrastructure/filesystem/path-publication.ts`
- Añade `unpublishPath(binDir)` con soporte para:
  - Dotfiles Unix: localiza y extirpa con precisión las líneas delimitadas por `# >>> forge614-engram PATH >>>` y `# <<< forge614-engram PATH <<<`.
  - Detección de alteraciones: Si faltan los delimitadores o el bloque fue adulterado, retorna `PATH_CONFLICT`.
  - Saneamiento de entradas escapadas o duplicadas.
  - Windows User PATH: remueve la entrada correspondiente de la variable de entorno de usuario.

### 4. `src/infrastructure/assistants/configuration.ts`
- Introduce soporte para desconfigurar y retirar bloques de integración:
  - Restaura archivos desde copias de respaldo si están intactas.
  - En caso contrario, retira de forma segura las claves MCP (`mcpServers.forge614-engram`) y los ganchos asociados sin alterar el resto de las propiedades del JSON.
  - Falla con `ASSISTANT_REMOVE_FAILED` si un archivo de configuración se encuentra corrupto.

### 5. Scripts de Instalación (`scripts/install.sh`, `scripts/install.ps1`, `scripts/install-from-source.sh`)
- Actualizados para instalar binarios en `~/.forge614/engram/bin/`.
- Configuran el PATH apuntando a la nueva ruta de ejecutables.
- Instalan el ejecutable; la migración de datos antiguos la realiza posteriormente Engram durante `setup` o `init`.

### 6. Catálogo de Errores (`src/shared/errors.ts`)
Se incorporaron 10 nuevos códigos de error canónicos para gobernar estas operaciones con precisión de diagnóstico:
- `LEGACY_UNSAFE`: Ruta legada insegura (symlink o propietario foráneo).
- `LEGACY_CONFLICT`: Archivos en destino o diarios huérfanos sin base de datos.
- `LEGACY_MIGRATION_FAILED`: Fallo durante el traslado físico de archivos con reversión ejecutada.
- `UNINSTALL_CONFIRMATION`: La frase de confirmación no coincide con la esperada.
- `ATLAS_UNINSTALL_REQUIRED`: Se detectó Atlas pero se omitió la confirmación de doble nivel.
- `ATLAS_UNINSTALL_FAILED`: El subproceso de desinstalación de Atlas reportó error o binario ausente.
- `ASSISTANT_REMOVE_FAILED`: Fallo al retirar bloques de configuración en asistentes.
- `PATH_CONFLICT`: Conflicto en dotfiles al intentar retirar la publicación de PATH.
- `CONFIG_INVALID`: Directorio no es ordinario o permisos octales no pueden asegurarse.

---

## 3. Garantías de Seguridad e Invariantes

1. **Aislamiento de Productos de la Suite:**
   - Engram tiene estrictamente prohibido mutar o borrar rutas pertenecientes a otros componentes de Forge614 (`shell/`, `atlas/`).
   - El desinstalador solo elimina `~/.forge614/engram/`; la carpeta `~/.forge614/` se mantiene si contiene otros productos o archivos del usuario.

2. **Propiedad y Permisos Privados:**
   - Todos los directorios creados por Engram se aseguran con permisos octales `0700` (`rwx------`).
   - Los archivos confidenciales (`.env`, `engram.db`) se escriben con permisos `0600` (`rw-------`).
   - Se rechazan enlaces simbólicos (*symlinks*) en cualquier nivel del hogar de producto para evitar ataques de salto de directorio (*path traversal*).

3. **Transaccionalidad en Migración:**
   - El traslado de archivos legados se realiza en orden estricto. Ante cualquier falla imprevista de E/S, todos los archivos que ya habían sido reubicados son restaurados a la raíz legada antes de emitir el error `LEGACY_MIGRATION_FAILED`.

4. **Desinstalación Guardada e Imposibilidad de Borrado Accidental:**
   - La desinstalación no ofrece opciones interactivas ni silenciosas con flags genéricos como `-y` o `--force`. Exige escribir la frase textual exacta en mayúsculas, garantizando una intención deliberada.

---

## 4. Evidencia de Verificación y Pruebas

Toda la suite de pruebas del proyecto fue ejecutada y verificada:

```bash
$ bun test
 572 pass
 15 skip
 2756 expect() calls
Ran 587 tests across 91 files. [38.13s]
```

- **Pruebas omitidas (15):** 9 corresponden a la suite de PostgreSQL aislado (requieren `FORGE614_TEST_POSTGRES_BIN`) y 6 a validaciones nativas de Windows en Node-API (requieren ejecución en SO Windows).
- **Tipado TypeScript:** `bun run typecheck` completado con código de salida `0` y cero advertencias.
- **Sintaxis de Shell Scripts:** `bash -n scripts/install.sh scripts/install-from-source.sh` completado sin errores.
- **Pruebas E2E de Instalador y Desinstalador:** Verificadas en `scripts/__tests__/install.sh.test.ts`, `src/app/uninstall.test.ts`, `src/infrastructure/filesystem/product-home.test.ts` y `src/infrastructure/filesystem/path-publication.test.ts`.

---

## 5. Documentación Actualizada

Los 19 documentos de la suite bilingüe de documentación oficial fueron actualizados para reflejar la candidata 1.1.0-beta.1 y su futuro estable 1.1.0:
- `docs/README.md`
- `docs/es/README.md` & `docs/en/README.md`
- `docs/es/01-instalacion-y-primeros-pasos.md` & `docs/en/01-installation-and-getting-started.md`
- `docs/es/02-recorrido-guiado.md` & `docs/en/02-guided-walkthrough.md`
- `docs/es/03-referencia-cli.md` & `docs/en/03-cli-reference.md`
- `docs/es/04-sdk-typescript.md` & `docs/en/04-typescript-sdk.md`
- `docs/es/05-arquitectura-interna-y-formulas.md` & `docs/en/05-internal-architecture-and-formulas.md`
- `docs/es/06-resolucion-de-errores.md` & `docs/en/06-troubleshooting.md`
- `docs/es/07-glosario.md` & `docs/en/07-glossary.md`
- `docs/es/08-limites-y-roadmap.md` & `docs/en/08-boundaries-and-roadmap.md`
- `docs/handoffs/19-engram-product-home-migration.md`
