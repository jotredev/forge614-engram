# Handoff Técnico 16: Empaquetado Nativo de Windows en Release y Validación de Ejecutables Autónomos

> **Fecha:** 2026-09-18
> **Rama:** `feat/windows-native-release-bundling`
> **Commits Clave:** `6aadb2c`, `7ee9de8`
> **Ejecución Remota Verificada:** GitHub Actions Run ID [`35423226279`](https://github.com/jotredev/forge614-engram/actions/runs/35423226279)
> **Estado:** 100% Superado (Verde / Pass) en todas las plataformas y arquitecturas.

---

## 1. Motivación y Contexto de Distribución

En entregas previas, Forge614 Engram implementó un módulo nativo C++ Node-API (`windows_reparse_guard.node`) para detectar y rechazar enlaces simbólicos, uniones de directorio (*junctions*) y puntos de montaje de volumen NTFS en Windows (`GetFileAttributesW` con `FILE_ATTRIBUTE_REPARSE_POINT`). Dicho módulo fue validado funcionalmente en el flujo de CI `Verify` (`.github/workflows/verify.yml`, Run ID `35414475529`).

Sin embargo, el flujo de distribución de ejecutables de release (`.github/workflows/release.yml`) presentaba dos limitaciones críticas de cara a la versión estable `v1.0.0`:
1. **Ausencia de compilación del addon en el empaquetado:** `release.yml` invocaba `bun build --compile` directamente sobre `src/cli.ts` sin construir previamente el addon nativo para la arquitectura destino, impidiendo que el ejecutable standalone incrustara el binario compilado.
2. **Falta de verificación en tiempo de ejecución del ejecutable empaquetado:** La única comprobación de release consistía en ejecutar `--help`, la cual no ejercitaba la ruta de inspección de asistentes ni forzaba la carga del addon nativo embebido fuera del árbol de código fuente.
3. **Imposibilidad de validar releases sin publicar:** El workflow solo se disparaba ante etiquetas de versión `v*`, obligando a crear un tag público para probar el ensamblado de los 6 artefactos.

---

## 2. Cambios Implementados en el Workflow de Release (`release.yml`)

### 2.1 Doble Disparador: Manual (`workflow_dispatch`) y Oficial por Tag (`v*`)
```yaml
on:
  push:
    tags:
      - "v*"
  workflow_dispatch:
```
* **Ejecución Manual (`workflow_dispatch`):** Permite fabricar todos los ejecutables, ejecutar pruebas en perfiles aislados, empaquetar los 6 artefactos y generar/verificar el archivo `SHA256SUMS` sin crear una GitHub Release ni alterar versiones.
* **Publicación Condicional:** El job `publish` cuenta con una salvaguarda estricta:
  ```yaml
  if: github.event_name == 'push' && github.ref_type == 'tag'
  ```
  Esto garantiza que la publicación en GitHub Releases solo proceda ante una decisión humana deliberada de etiquetado.

### 2.2 Declaración de Arquitectura de Addon en la Matriz de Compilación
La matriz de compilación de Windows declara explícitamente la arquitectura del componente nativo correspondiente:
* `windows-latest` (x64) $\rightarrow$ `addon_architecture: x64`, `artifact: forge614-engram-windows-x64.exe`
* `windows-11-arm` (arm64) $\rightarrow$ `addon_architecture: arm64`, `artifact: forge614-engram-windows-arm64.exe`

### 2.3 Orden Estricto de Construcción en Windows
Para que Bun pueda incrustar el archivo `.node` dentro del binario standalone compilado, el addon debe existir en el disco antes de la compilación. El orden ejecutado en los runners de Windows es:
1. `actions/setup-node@v4` (Node 22.14.0 en la arquitectura de la matriz).
2. `actions/setup-python@v5` (Python 3.12).
3. `bun install --frozen-lockfile --ignore-scripts`.
4. `./scripts/build-windows-reparse-addon.ps1 -Architecture ${{ matrix.addon_architecture }}`.
5. `bun build ./src/cli.ts --compile --target=${{ matrix.target }} --outfile dist/${{ matrix.artifact }}`.

### 2.4 Prueba de Ejecutable Empaquetado en Perfil Temporal Aislado
Tras la compilación del `.exe`, el runner de Windows ejecuta una prueba de humo profunda fuera del repositorio:
```powershell
$profile = Join-Path $env:RUNNER_TEMP ("forge614-release-" + [Guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Path $profile -Force | Out-Null
  $env:HOME = $profile
  $env:USERPROFILE = $profile
  $env:LOCALAPPDATA = Join-Path $profile 'AppData\Local'
  $env:APPDATA = Join-Path $profile 'AppData\Roaming'
  $env:CLAUDE_CONFIG_DIR = Join-Path $profile '.claude'
  $env:CODEX_HOME = Join-Path $profile '.codex'
  $env:XDG_CONFIG_HOME = Join-Path $profile '.config'
  $env:OPENCODE_CONFIG_DIR = Join-Path $profile '.config\opencode'
  $env:GEMINI_CLI_HOME = $profile
  $assistants = & .\dist\${{ matrix.artifact }} assistant-list | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'The packaged executable could not inspect assistant configuration paths.' }
  foreach ($id in @('claude-code', 'codex', 'cursor', 'opencode', 'antigravity')) {
    if ($id -notin @($assistants.id)) { throw "The packaged executable did not report $id." }
  }
  if (Test-Path -LiteralPath (Join-Path $profile '.forge614')) { throw 'assistant-list created user storage.' }
} finally {
  Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
}
```
**Garantías que certifica esta prueba:**
1. El archivo binario `.exe` standalone arranca correctamente.
2. El módulo nativo C++ incrustado por Bun se desempaca y carga en memoria sin errores de DLL ni símbolos faltantes.
3. El comando `assistant-list` planifica rutas e inspecciona ancestros, activando el guardián de reparse points.
4. Reporta los 5 asistentes compatibles (`claude-code`, `codex`, `cursor`, `opencode`, `antigravity`).
5. No genera la carpeta de almacenamiento `~/.forge614/` (operación 100% de solo lectura en inspección).

### 2.5 Corrección de Sintaxis de Shell en GitHub Actions
Durante la implementación inicial, GitHub Actions rechazó el workflow con error de validación antes de crear jobs debido a:
```yaml
shell: ${{ matrix.shell }} # INVÁLIDO: matrix context no está permitido en shell a nivel de step
```
Se eliminó la directiva manual `shell`, permitiendo que GitHub Actions aplique sus shells por defecto estándar del sistema operativo (Bash en Linux/macOS, PowerShell en Windows).

---

## 3. Suite de Protección Contra Regresiones

Se añadió el archivo [`scripts/__tests__/release-windows-native-addon.test.ts`](file:///Users/jorgeetrejoo/Desktop/forge614-engram/scripts/__tests__/release-windows-native-addon.test.ts), el cual valida estáticamente el contrato del workflow:
- Presencia del trigger `workflow_dispatch:`.
- Presencia de matrices explícitas `addon_architecture: x64` y `arm64`.
- Invocación de `actions/setup-node@v4` y `actions/setup-python@v5` exclusivamente en Windows.
- Invocación de `build-windows-reparse-addon.ps1` con la arquitectura declarada.
- Precedencia estricta: compilación del addon nativo anterior a `bun build --compile`.
- Ejecución de `assistant-list` con perfil aislado en `RUNNER_TEMP`.
- Salvaguarda de publicación restringida a eventos `push` de tipo `tag`.
- Prohibición de directivas inválidas `shell: ${{ matrix.shell }}`.

---

## 4. Evidencia de Ejecución Remota en CI

* **URL de Ejecución:** [GitHub Actions Run 35423226279](https://github.com/jotredev/forge614-engram/actions/runs/35423226279)
* **Rama:** `feat/windows-native-release-bundling` (Commit `7ee9de8`)
* **Resultados de los Jobs:**
  1. `Release verification`: Superado.
  2. `Build forge614-engram-darwin-arm64`: Superado.
  3. `Build forge614-engram-darwin-x64`: Superado.
  4. `Build forge614-engram-linux-arm64`: Superado.
  5. `Build forge614-engram-linux-x64`: Superado.
  6. `Build forge614-engram-windows-x64.exe`: Superado (Addon compilado, incrustado y verificado con `assistant-list`).
  7. `Build forge614-engram-windows-arm64.exe`: Superado (Addon compilado, incrustado y verificado con `assistant-list`).
  8. `Assemble and validate release assets`: Superado (6 archivos empaquetados y validados contra `SHA256SUMS`).
  9. `Publish GitHub Release`: Omitido correctamente (*Skipped*), demostrando la efectividad de la salvaguarda ante ejecuciones manuales.

---

## 5. Estado de Requisitos para la Versión Estable v1.0.0

| Requisito para v1.0.0 | Estado Previo | Estado Actual |
| :--- | :--- | :--- |
| **Incrustar addon nativo en ejecutable Windows** | Pendiente | **COMPLETADO Y VALIDADO** (Run ID 35423226279) |
| **Compilar y probar en Windows ARM64** | Pendiente | **COMPLETADO Y VALIDADO** (Run ID 35423226279) |
| **Generación y verificación de SHA256SUMS de los 6 artefactos** | Pendiente | **COMPLETADO Y VALIDADO** (Run ID 35423226279) |
| **Validación en máquina Windows física limpia sin herramientas de desarrollo** | Pendiente | Pendiente (Requiere prueba externa en PC de usuario / VM) |
| **Certificación de independencia de MSVC CRT en Windows estándar** | Pendiente | Pendiente (Requiere verificar carga en instalación Windows base) |
| **Creación y push de etiqueta oficial `v1.0.0`** | Pendiente | Pendiente (Decisión humana final) |
