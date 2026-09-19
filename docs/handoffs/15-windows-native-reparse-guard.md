# 15. Windows Native Reparse Guard, Guarded Write Protocol & CI Verification

Fecha: 2026-09-18. Rama: `feat/cross-platform-setup`.  
Estado: Implementado, probado y validado en CI de GitHub Actions (Run ID `35414475529`). Pendiente de empaquetado standalone y validación ARM64 para v1.0.0.

---

## 1. Resumen Ejecutivo y Motivación

En sistemas Unix (macOS y Linux), la prevención de redirecciones maliciosas de archivos se resuelve de manera estándar mediante permisos octales POSIX (`0700` y `0600`) y banderas de apertura directas del kernel (`O_NOFOLLOW`). En Windows:
1. Los permisos POSIX no existen de forma nativa (se sintetizan sobre listas de control de acceso NTFS, ACLs).
2. Bun en Windows carece de soporte directo para la bandera `O_NOFOLLOW` en la apertura ordinaria de descriptores.
3. El sistema de archivos NTFS ofrece múltiples tipos de redirección: enlaces simbólicos de archivo, enlaces simbólicos de directorio, uniones de directorio (*junctions*) y puntos de montaje de volumen (*volume mount points*).

Para proteger las rutas de configuración de asistentes (como Antigravity, Claude Code, Cursor y OpenCode) y del espacio central (`~/.forge614`), Forge614 Engram incorpora un **componente nativo C++ Node-API** que consulta directamente la API oficial de Windows y un protocolo de escritura protegida de 10 pasos (`guardedWrite`).

---

## 2. Componente Nativo C++ Node-API (`native/windows-reparse-guard/`)

### 2.1. Arquitectura y Decisión Técnica
- **Por qué no subprocesos:** Invocar `powershell.exe` o `fsutil.exe` agrega entre 150 ms y 400 ms por chequeo, consume memoria y puede requerir privilegios administrativos.
- **Por qué no Bun FFI:** La documentación oficial de Bun califica FFI como experimental y no recomendado para ejecutables autónomos compilados en producción.
- **Node-API (.node):** Interfaz binaria nativa estable recomendada por Bun para extensiones C/C++. Se compila en una biblioteca dinámica compartida ultraligera cargada en el mismo espacio de memoria del proceso.

### 2.2. Implementación en C++ (`addon.cc`)
El archivo `native/windows-reparse-guard/addon.cc` expone la función `hasWindowsReparsePoint(path: string): boolean`:
```cpp
#include <windows.h>
#include <node_api.h>

// Convierte la ruta UTF-8 a UTF-16 y consulta directamente Kernel32.dll
DWORD attributes = GetFileAttributesW(widePath);
if (attributes == INVALID_FILE_ATTRIBUTES) {
  // Lanza excepción si la ruta no existe o es inaccesible
  napi_throw_error(env, nullptr, "Failed to read file attributes");
  return nullptr;
}
bool isReparsePoint = (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
```

### 2.3. Cargador TypeScript y Modelo Fail-Closed
- **Cargador (`src/infrastructure/filesystem/windows-reparse-guard.ts`):** Requiere plataforma `win32`, carga el archivo `windows_reparse_guard.node` y valida que el retorno sea un booleano estricto.
- **Validador de Jerarquía (`src/infrastructure/filesystem/private-files.ts` - `assertNoWindowsReparsePoints`):** Recorre la ruta de destino y **todos los directorios padres existentes** de manera ascendente hasta la raíz (`while (current !== root)`).
- **Modelo *Fail-Closed*:** Si el addon `.node` no existe, lanza un error del sistema operativo, o devuelve un resultado no booleano, la validación falla cerrando el paso y arrojando `UNSAFE_PATH`.

---

## 3. Protocolo de Publicación Protegida (`guardedWrite`)

El flujo de escritura atómica en `src/infrastructure/filesystem/private-files.ts` ejecuta 10 pasos rigurosos:
1. **Validación previa de ruta:** Invoca `assertSafePath` (permisos POSIX en Unix; inspección ascendente de reparse points en Windows).
2. **Contraste con la vista previa:** Comprueba que el contenido en disco coincida byte a byte con `write.before`. Si otro proceso lo modificó, aborta con `CHANGED`.
3. **Creación segura de directorios padres:** Asegura la carpeta contenedora con `mkdirSync(..., { mode: 0700 })` y re-valida inmediatamente con `assertSafePath`.
4. **Copia de respaldo exclusiva:** Si existía archivo previo, crea una copia `.forge614-backup-<UUID>` con permisos `0600` y modo exclusivo (`flag: 'wx'`).
5. **Creación exclusiva de archivo temporal:** Abre `.forge614-tmp-<UUID>` mediante `openSync` utilizando el modo seguro retornado por `safeOpenFlag`.
6. **Escritura y forzado a disco:** Escribe el nuevo contenido y llama a `fsyncSync(fd)` para asegurar la persistencia física en el medio antes de avanzar.
7. **Re-verificación previa al reemplazo:** Vuelve a leer el archivo original. Si cambió durante la preparación, aborta con `CHANGED` y retiene el respaldo.
8. **Reemplazo atómico:** Re-valida la ruta y ejecuta `io.rename(temporary, write.path)`.
9. **Verificación posterior de bytes (*Post-Publication Verification*):** Lee el archivo final con `readSafeFile`. Si los bytes no coinciden con `write.after`, arroja `PUBLISHED_UNVERIFIED`. El respaldo se conserva intacto y no se realiza un rollback destructivo que pudiera dañar datos externos.
10. **Limpieza en bloque `finally`:** Si ocurrió un error antes de completar el renombre, elimina el archivo temporal con `unlinkSync`.

---

## 4. Diferencias de Plataforma y Resolución del Incidente en CI

### 4.1. Modos de Apertura de Archivos
La función auxiliar `safeOpenFlag(unixFlags, windowsFlag)` aísla el comportamiento por sistema operativo:
* **Windows:**
  - Lectura: `"r"`.
  - Creación exclusiva de temporales y respaldos: `"wx"`. La bandera `"x"` (*exclusive*) garantiza que si el archivo ya existía, el kernel rechace la llamada arrojando `EEXIST`.
* **macOS / Linux:**
  - Lectura: `constants.O_RDONLY | constants.O_NOFOLLOW`.
  - Creación exclusiva: `constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW` con permisos octales `0600`.

### 4.2. Incidente Técnico en CI
En GitHub Actions sobre ejecutores Windows, la llamada `openSync(temp, O_WRONLY | O_CREAT | O_EXCL)` en Bun arrojaba un error de sistema `ENOENT`. En el mismo archivo, la creación de respaldos funcionaba correctamente porque usaba el modo textual `{ flag: 'wx' }`. Al cambiar la apertura de temporales a `"wx"` mediante `safeOpenFlag`, las pruebas de escritura y publicación pasaron exitosamente.

---

## 5. Cadena de Herramientas y Compilación en Windows

### 5.1. Script de Compilación (`scripts/build-windows-reparse-addon.ps1`)
Orquesta la compilación del módulo C++ para arquitecturas `x64` y `arm64`:
- **Bun (`>=1.3.8`):** Runtime de TypeScript.
- **Node.js (`22.14.0` en CI):** Utilizado exclusivamente en tiempo de compilación para ejecutar `node-gyp`. No es requerido en tiempo de ejecución por el usuario final.
- **`node-gyp` (`12.1.0` fijado en `devDependencies`):** Versión necesaria para garantizar compatibilidad con Node 22 y Visual Studio 2026.
- **Python (`3.12+`):** Requerido por GYP (`gyp_main.py`).
- **Visual Studio 2026 Build Tools (v18):** Compilador oficial de Microsoft provisto en `windows-latest`.

### 5.2. Resolución Unívoca de `node.exe`
En máquinas virtuales con múltiples instalaciones de Node.js en el PATH, `Resolve-NodeExecutable` filtra la salida y selecciona **una única ruta ejecutable válida**, evitando errores de concatenación de comandos en PowerShell.

---

## 6. Evidencia de Validación en CI (GitHub Actions)

* **Run ID:** `35414475529`
* **URL:** `https://github.com/jotredev/forge614-engram/actions/runs/35414475529`
* **Commit:** `5f9867ddcb7521e6e4fd1c05d53ab565506b8534`
* **Resultado:** **Pass / Verde** en los 3 trabajos:
  - `ubuntu-latest` (Job ID: `105820262159`)
  - `macos-latest` (Job ID: `105820262057`)
  - `windows-latest` (Job ID: `105820262087`)
* **Pruebas Superadas en el Job Nativo de Windows x64:**
  1. Compilación de `windows_reparse_guard.node` con VS 2026 y node-gyp 12.1.0.
  2. Detección y rechazo de enlaces simbólicos de archivo (`symlinkSync(..., 'file')`).
  3. Detección y rechazo de uniones de directorio NTFS (*junctions*).
  4. Detección y rechazo de puntos de montaje de volumen (*volume mount points* con `mountvol.exe`).
  5. Fallo seguro (*fail-closed*) ante excepciones o resultados anómalos.
  6. Publicación exitosa de configuración de Antigravity en `%USERPROFILE%\.gemini\config\mcp_config.json`.
  7. Aprobación de los 5 escenarios de prueba del instalador PowerShell (`install.ps1.test.ps1`) sobre servidor loopback efímero (`127.0.0.1`).

---

## 7. Límites de Seguridad y Concurrencia (TOCTOU)

La inspección previa de rutas mitiga de manera efectiva la existencia de desvíos maliciosos preexistentes. Sin embargo, no proporciona una garantía matemática absoluta frente a condiciones de carrera (*Time-of-Check to Time-of-Use*, TOCTOU) donde otro proceso con privilegios modifique la jerarquía del directorio exactamente entre el chequeo y la apertura del archivo.

---

## 8. Tareas Pendientes para Distribución Estable (v1.0.0)

1. **Incrustar el addon nativo en el binario standalone:** Configurar `.github/workflows/release.yml` para compilar el addon nativo antes de `bun build --compile` y verificar que el ejecutable resultante cargue la extensión sin requerir archivos `.node` externos.
2. **Compilar y probar en Windows ARM64:** Validar la suite en ejecutores nativos `windows-11-arm`.
3. **Prueba en máquina Windows limpia:** Validar instalación y ejecución del ejecutable en un entorno sin Node.js, Python ni herramientas de compilación.
4. **Verificación de dependencias CRT:** Certificar que el binario no requiera redistribuibles de C++ (*MSVC CRT*) ausentes en sistemas Windows base.
5. **Verificación del proceso de release:** Comprobar la generación y firma de los 6 artefactos de release antes de publicar v1.0.0.
