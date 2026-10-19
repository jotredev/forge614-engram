/**
 * Desinstala Forge614 Engram del disco: pide confirmación textual exacta, desinstala
 * primero Forge614 Atlas si está presente (Engram es su dependencia), retira la entrada
 * de PATH y por último borra la carpeta de instalación. En Windows, si el proceso corre
 * desde el propio binario a eliminar, programa el borrado diferido mediante WMI y PowerShell.
 */
import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync, type Stats } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { MemoryError } from "../shared/errors";
import { removePathPublication } from "../infrastructure/filesystem/path-publication";
import { assertSafePath } from "../infrastructure/filesystem/private-files";
import { engramBinDirectory, engramHome, forge614Home, memoryHome } from "../infrastructure/filesystem/paths";
import { ensureMemoryBeforeUninstall } from "../infrastructure/filesystem/memory-location";

/** Opciones para spawn al invocar el lanzador WMI en Windows. */
export interface UninstallSpawnOptions {
  readonly windowsHide?: boolean;
}

/** Resultado de spawn al invocar el lanzador WMI en Windows. */
export interface UninstallSpawnResult {
  readonly status: number | null;
  readonly error?: Error;
}

/** Lo que quien llama debe aportar para autorizar la desinstalación: `confirmation` es la frase exacta que la persona debe escribir para confirmar, que varía según si Atlas también se va a quitar. */
export interface UninstallInput { confirmation: string; purgeData?: boolean; }
/** Piezas que `uninstallEngram` necesita del entorno; sustituibles en las pruebas. */
export interface UninstallDependencies {
  /** Carpeta personal a usar en vez de `homedir()`. */
  home?: string;
  /** Carpeta raíz de Forge614 a usar en vez de `forge614Home()`; si se da, cambia también dónde se busca el binario. */
  forgeHome?: string;
  /** Ruta del ejecutable de Engram en uso (informativa en Unix; en Windows detecta si coincide con el binario instalado). */
  executable: string;
  /** Sustituye la ejecución real del desinstalador de Atlas (usado en pruebas). */
  runAtlasUninstall?: (command: string, args: string[]) => Promise<number>;
  /** Sustituye la función real que retira la entrada de PATH (usado en pruebas). */
  removePathPublication?: (home: string, binDirectory: string) => Promise<string[]>;
  /** Plataforma del sistema operativo (por defecto `process.platform`). */
  platform?: string;
  /** Identificador de proceso a esperar en el borrado diferido (por defecto `process.pid`). */
  processId?: number;
  /** Raíz temporal para crear los scripts y logs de paso (por defecto `tmpdir()`). */
  tempRoot?: string;
  /** Directorio actual del proceso; permite rechazar desinstalarse desde dentro del nodo. */
  cwd?: string;
  /** Función inyectable para ejecutar comandos (usada para lanzar WMI en Windows). */
  spawn?: (command: string, args: string[], options?: UninstallSpawnOptions) => UninstallSpawnResult;
  /** Sustituye la retirada precisa de integraciones administradas por Engines en las pruebas. */
  runEnginesSelf?: (command: string, args: string[]) => Promise<number>;
}
/** Resumen de lo que la desinstalación efectivamente hizo: `removed` si la carpeta de instalación de Engram existía y se borró; `atlasRemoved` si Forge614 Atlas estaba presente y se desinstaló como parte de este proceso; `pathPublications` las rutas o identificadores de los que se retiró la publicación en PATH; `pendingRemoval` si el borrado quedó programado en segundo plano en Windows. */
export interface UninstallResult {
  removed: boolean;
  atlasRemoved: boolean;
  memoryKept: boolean;
  memoryPath: string;
  pathPublications: string[];
  pendingRemoval?: boolean;
  remainingExecutablePath?: string;
}

/** Resultado del hook invocado por `install.mjs` antes de borrar `engram/`. */
export interface SelfUninstallResult { integrationsRemoved: true; memoryKept: true; memoryPath: string; atlasRemains: boolean; }

/** Da la frase localizada que confirma el alcance real de desinstalación y borrado de datos. */
export function uninstallConfirmation(forgeHome = forge614Home(), purgeData = false): string {
  const withAtlas = safeDirectory(join(forgeHome, 'atlas')) !== null;
  if (purgeData) return withAtlas
    ? 'BORRAR MEMORIA LOCAL Y CONFIGURACIÓN DE NUBE; DESINSTALAR ENGRAM Y ATLAS'
    : 'BORRAR MEMORIA LOCAL Y CONFIGURACIÓN DE NUBE; DESINSTALAR ENGRAM';
  return withAtlas ? 'DESINSTALAR ENGRAM Y ATLAS' : 'DESINSTALAR ENGRAM';
}

/** Devuelve la ruta privada donde Engram guarda la memoria para los avisos del CLI. */
export function uninstallMemoryPath(): string { return memoryHome(); }

const WINDOWS_UNINSTALL_HELPER_SCRIPT = `
param(
  [string]$TargetDir,
  [string]$ParentDir,
  [string]$ParkedExe,
  [int]$ProcessId,
  [string]$StagingDir,
  [string]$LogFile
)
"$(Get-Date -Format o) starting uninstall helper" | Out-File -FilePath $LogFile -Append

if ($ProcessId -gt 0) {
  $waited = 0
  while ((Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) -and ($waited -lt 120)) {
    Start-Sleep -Milliseconds 250
    $waited++
  }
  if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
    "$(Get-Date -Format o) process $ProcessId did not exit within timeout; aborting uninstall" | Out-File -FilePath $LogFile -Append
    exit 1
  }
}

for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 250
  try {
    if ($ParkedExe -and (Test-Path -LiteralPath $ParkedExe)) {
      Remove-Item -LiteralPath $ParkedExe -Force -ErrorAction Stop
    }
    if (-not (Test-Path -LiteralPath $TargetDir)) {
      "$(Get-Date -Format o) target dir does not exist; uninstall complete" | Out-File -FilePath $LogFile -Append
      Remove-Item -LiteralPath $StagingDir -Recurse -Force -ErrorAction SilentlyContinue
      exit 0
    }
    $targetItem = Get-Item -LiteralPath $TargetDir -Force
    if (-not $targetItem.PSIsContainer) {
      "$(Get-Date -Format o) target path is not a directory: $TargetDir" | Out-File -FilePath $LogFile -Append
      exit 1
    }
    if (($targetItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      "$(Get-Date -Format o) target path is a reparse point: $TargetDir" | Out-File -FilePath $LogFile -Append
      exit 1
    }
    $parentItem = Get-Item -LiteralPath $ParentDir -Force
    if (-not $parentItem.PSIsContainer -or ($parentItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      "$(Get-Date -Format o) parent path is not a safe directory: $ParentDir" | Out-File -FilePath $LogFile -Append
      exit 1
    }
    if ($targetItem.Parent.FullName -ne $parentItem.FullName) {
      "$(Get-Date -Format o) target parent mismatch: expected $($parentItem.FullName) but got $($targetItem.Parent.FullName)" | Out-File -FilePath $LogFile -Append
      exit 1
    }
    if ($targetItem.Name -ne "engram") {
      "$(Get-Date -Format o) target folder name is not engram: $($targetItem.Name)" | Out-File -FilePath $LogFile -Append
      exit 1
    }
    Remove-Item -LiteralPath $TargetDir -Recurse -Force -ErrorAction Stop
  } catch {
    "$(Get-Date -Format o) attempt $i removal failed: $_" | Out-File -FilePath $LogFile -Append
    continue
  }
  if (-not (Test-Path -LiteralPath $TargetDir)) {
    "$(Get-Date -Format o) uninstall succeeded on attempt $i" | Out-File -FilePath $LogFile -Append
    Remove-Item -LiteralPath $StagingDir -Recurse -Force -ErrorAction SilentlyContinue
    exit 0
  }
}
"$(Get-Date -Format o) uninstall did not succeed after all retries" | Out-File -FilePath $LogFile -Append
exit 1
`;

const WINDOWS_WMI_LAUNCH_SCRIPT = `
param(
  [string]$CommandLine,
  [string]$SpawnLogPath
)
try {
  $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $CommandLine }
  if ($result.ReturnValue -ne 0) {
    "$(Get-Date -Format o) Win32_Process.Create failed with ReturnValue=$($result.ReturnValue) for: $CommandLine" | Out-File -FilePath $SpawnLogPath -Append
    exit 1
  }
  "$(Get-Date -Format o) Win32_Process.Create succeeded, ProcessId=$($result.ProcessId) for: $CommandLine" | Out-File -FilePath $SpawnLogPath -Append
} catch {
  "$(Get-Date -Format o) Win32_Process.Create threw: $_" | Out-File -FilePath $SpawnLogPath -Append
  exit 1
}
`;

function quoteWindowsArg(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"';
}

function isSameExecutable(exe1: string, exe2: string, isWindows: boolean): boolean {
  if (!exe1 || !exe2) return false;
  const norm1 = resolve(exe1).replace(/\//g, "\\");
  const norm2 = resolve(exe2).replace(/\//g, "\\");
  return isWindows ? norm1.toLowerCase() === norm2.toLowerCase() : norm1 === norm2;
}

/** Como `lstatSync`, pero devuelve `null` en vez de lanzar cuando la ruta no existe. */
function stat(path: string): Stats | null {
  try { return lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

/** Quita solo los ejecutables que una actualización Windows apartó en una operación anterior. */
function cleanupOldLaunchers(binDirectory: string): void {
  for (const name of readdirSync(binDirectory, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.startsWith(".old-")).map(entry => entry.name)) {
    rmSync(join(binDirectory, name), { force: true });
  }
}

/**
 * Confirma que `path` es una carpeta real, no un enlace simbólico y no tiene en su
 * ascendencia ningún enlace simbólico fuera de los alias del sistema que permite
 * `assertSafePath`, antes de autorizar que se borre.
 * @param path Ruta a comprobar.
 * @returns La información (`Stats`) de la carpeta, o `null` si no existe.
 * @throws MemoryError con código `UNINSTALL_UNSAFE` si la ruta existe pero no es una
 * carpeta segura para borrar (no es carpeta, es un enlace, o su ruta no es segura).
 */
function safeDirectory(path: string): Stats | null {
  const entry = stat(path);
  if (!entry) return null;
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new MemoryError('UNINSTALL_UNSAFE', 'La carpeta que se eliminaría no es una carpeta segura de Forge614 Engram.');
  try { assertSafePath(path); }
  catch { throw new MemoryError('UNINSTALL_UNSAFE', 'La carpeta que se eliminaría no es una carpeta segura de Forge614 Engram.'); }
  return entry;
}

/** Rechaza borrar el nodo desde un proceso cuyo directorio actual depende de esa carpeta. */
function assertNotRunningFromInstallation(root: string, cwd: string): void {
  if (!safeDirectory(root)) return;
  const realRoot = realpathSync.native(root);
  const realCwd = realpathSync.native(cwd);
  const child = relative(realRoot, realCwd);
  if (child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith("../") && !child.startsWith("..\\"))) {
    throw new MemoryError("UNINSTALL_FROM_INSTALLATION", "No se puede desinstalar Forge614 Engram desde una carpeta dentro de su instalación.");
  }
}

/** Ejecuta de verdad el binario de Atlas con los argumentos dados, sin heredar entrada ni salida, y espera su código de salida. */
async function defaultAtlasRunner(command: string, args: string[]): Promise<number> {
  const child = Bun.spawn([command, ...args], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
  return await child.exited;
}

/**
 * Ejecuta la desinstalación completa: valida la frase de confirmación, desinstala Atlas
 * si corresponde, retira el acceso por PATH y borra la carpeta de instalación de Engram.
 * El orden importa: Atlas se quita antes que Engram (Atlas depende de Engram), y el PATH
 * se retira antes de borrar archivos para no dejar un ejecutable roto referenciado.
 * En Windows, si el proceso corre desde el ejecutable instalado dentro de `engram/bin`,
 * programa el ayudante en segundo plano vía WMI para relevar el borrado tras salir.
 * @param input Frase de confirmación escrita por la persona.
 * @param dependencies Rutas y funciones sustituibles descritas en {@link UninstallDependencies}.
 * @returns Qué se borró, si Atlas se desinstaló y de dónde se retiró el PATH.
 * @throws MemoryError con código `UNINSTALL_UNSAFE` si la carpeta de Atlas o de Engram no
 * son seguras de borrar; `UNINSTALL_CONFIRMATION` si la frase no coincide exactamente con
 * la esperada; `ATLAS_UNINSTALL_REQUIRED` si Atlas está presente pero su ejecutable no se
 * encuentra; `ATLAS_UNINSTALL_FAILED` si el desinstalador de Atlas falla o termina con
 * código distinto de 0; `PATH_REMOVE_FAILED` si no se puede retirar la entrada de PATH;
 * `UNINSTALL_SCHEDULE_FAILED` si en Windows no se puede programar el ayudante por WMI.
 */
export async function uninstallEngram(input: UninstallInput, dependencies: UninstallDependencies): Promise<UninstallResult> {
  const platform = dependencies.platform ?? process.platform;
  const home = dependencies.home ?? homedir();
  const parent = dependencies.forgeHome ?? forge614Home();
  // Si se dio una carpeta raíz de Forge614 alternativa (pruebas), Engram vive dentro de ella en `engram/`.
  const root = dependencies.forgeHome === undefined ? engramHome() : join(parent, 'engram');
  const binDirectory = dependencies.forgeHome === undefined ? engramBinDirectory() : join(root, 'bin');
  assertNotRunningFromInstallation(root, dependencies.cwd ?? process.cwd());
  let memoryPath: string;
  try { memoryPath = await ensureMemoryBeforeUninstall(parent, root); }
  catch { throw new MemoryError('MEMORY_PRESERVATION_FAILED', 'No se pudo asegurar una copia completa de la memoria; Engram no se desinstaló.'); }
  try { cleanupOldLaunchers(binDirectory); } catch { /* El borrado de versiones anteriores no bloquea la conservación de datos. */ }
  const atlas = join(parent, 'atlas');
  const hasAtlas = safeDirectory(atlas) !== null;
  // La frase de confirmación exigida cambia según si también se va a desinstalar Atlas, para que la persona sepa el alcance real.
  const expected = uninstallConfirmation(parent, input.purgeData === true);
  if (input.confirmation !== expected) throw new MemoryError('UNINSTALL_CONFIRMATION', 'Escribe exactamente: ' + expected);

  if (hasAtlas) {
    const atlasCommand = join(atlas, 'bin', platform === 'win32' ? 'forge614-atlas.exe' : 'forge614-atlas');
    const runner = dependencies.runAtlasUninstall ?? defaultAtlasRunner;
    if (!stat(atlasCommand)) throw new MemoryError('ATLAS_UNINSTALL_REQUIRED', 'Forge614 Atlas existe pero no está disponible para desinstalarse de forma segura.');
    // Se le pide a Atlas que se desinstale a sí mismo con `--confirmed` para que no vuelva a pedir confirmación interactiva.
    let exitCode: number;
    try {
      exitCode = await runner(atlasCommand, ['uninstall', '--from', 'forge614-engram', '--confirmed']);
    } catch {
      throw new MemoryError('ATLAS_UNINSTALL_FAILED', 'Forge614 Atlas no pudo desinstalarse; Engram no se modificó.');
    }
    if (exitCode !== 0) throw new MemoryError('ATLAS_UNINSTALL_FAILED', 'Forge614 Atlas no pudo desinstalarse; Engram no se modificó.');
  }

  // Se comprueba que la carpeta de Engram es segura de borrar antes de tocar el PATH, para no dejar el PATH sin la carpeta si esta no fuera válida.
  const product = safeDirectory(root);
  let pathPublications: string[];
  try {
    const removeFn = dependencies.removePathPublication ?? ((candidateHome, candidateBinDirectory) =>
      removePathPublication({ home: candidateHome, binDirectory: candidateBinDirectory, platform }));
    pathPublications = await removeFn(home, binDirectory);
  } catch {
    throw new MemoryError('PATH_REMOVE_FAILED', 'No se pudo retirar de forma segura el acceso de Forge614 Engram en PATH; los datos de Engram se conservaron.');
  }

  if (!product) {
    return { removed: false, atlasRemoved: hasAtlas, memoryKept: true, memoryPath, pathPublications };
  }

  const isWindows = platform === 'win32';
  const targetExe = join(binDirectory, isWindows ? 'forge614-engram.exe' : 'forge614-engram');

  if (isWindows && isSameExecutable(dependencies.executable, targetExe, true)) {
    const tempBase = dependencies.tempRoot ?? tmpdir();
    const stagingDir = mkdtempSync(join(tempBase, 'forge614-engram-uninstall-step-'));
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const logFile = join(tempBase, `forge614-engram-uninstall-${stamp}.log`);
    const spawnLogPath = join(tempBase, `forge614-engram-uninstall-${stamp}.spawn.log`);
    const parkedExe = join(tempBase, `.old-forge614-engram-${stamp}${basename(targetExe).endsWith('.exe') ? '.exe' : ''}`);
    let executableParked = false;

    try {
      if (stat(targetExe)) { renameSync(targetExe, parkedExe); executableParked = true; }
      const helperPath = join(stagingDir, 'helper.ps1');
      const wmiLaunchPath = join(stagingDir, 'wmi-launch.ps1');

      writeFileSync(helperPath, WINDOWS_UNINSTALL_HELPER_SCRIPT);
      writeFileSync(wmiLaunchPath, WINDOWS_WMI_LAUNCH_SCRIPT);

      const processId = dependencies.processId ?? process.pid;
      const helperArgs = [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', helperPath,
        '-TargetDir', root,
        '-ParentDir', parent,
        '-ParkedExe', parkedExe,
        '-ProcessId', String(processId),
        '-StagingDir', stagingDir,
        '-LogFile', logFile,
      ];

      let scheduled = false;
      const spawnFn = dependencies.spawn ?? spawnSync;

      for (const shell of ['pwsh', 'powershell.exe']) {
        const targetCommandLine = [shell, ...helperArgs].map(quoteWindowsArg).join(' ');
        const wrapperArgs = [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-File', wmiLaunchPath,
          '-CommandLine', targetCommandLine,
          '-SpawnLogPath', spawnLogPath,
        ];
        const res = spawnFn(shell, wrapperArgs, { windowsHide: true });
        if (res.status === 0) {
          scheduled = true;
          break;
        }
      }

      if (!scheduled) {
        rmSync(root, { recursive: true, force: false, maxRetries: 0 });
        rmSync(stagingDir, { recursive: true, force: true });
        if (input.purgeData) purgeMemoryDirectory(parent, memoryPath);
        return {
          removed: true,
          atlasRemoved: hasAtlas,
          memoryKept: !input.purgeData,
          memoryPath,
          pathPublications,
          ...(executableParked ? { remainingExecutablePath: parkedExe } : {}),
        };
      }

      if (input.purgeData) purgeMemoryDirectory(parent, memoryPath);
      return { removed: false, atlasRemoved: hasAtlas, memoryKept: !input.purgeData, memoryPath, pathPublications, pendingRemoval: true };
    } catch (error) {
      rmSync(stagingDir, { recursive: true, force: true });
      try { rmSync(logFile, { force: true }); } catch {}
      try { rmSync(spawnLogPath, { force: true }); } catch {}
      if (error instanceof MemoryError) throw error;
      throw new MemoryError('UNINSTALL_SCHEDULE_FAILED', 'No se pudo programar la desinstalación en segundo plano de Forge614 Engram; los datos se conservaron.');
    }
  }

  // Solo se borra si la carpeta existía (`product` no es null); `force:false` y `maxRetries:0` evitan reintentos silenciosos ante un borrado parcial.
  rmSync(root, { recursive: true, force: false, maxRetries: 0 });
  if (input.purgeData) purgeMemoryDirectory(parent, memoryPath);
  return { removed: true, atlasRemoved: hasAtlas, memoryKept: !input.purgeData, memoryPath, pathPublications };
}

/** Borra únicamente la carpeta de memoria verificada que queda fuera del directorio del programa. */
function purgeMemoryDirectory(forgeHome: string, memoryPath: string): void {
  if (resolve(memoryPath) !== resolve(join(forgeHome, 'memory'))) throw new MemoryError('MEMORY_PURGE_FAILED', 'La ruta de memoria no es segura para borrar.');
  const directory = safeDirectory(memoryPath);
  if (directory) rmSync(memoryPath, { recursive: true, force: false, maxRetries: 0 });
  if (stat(memoryPath)) throw new MemoryError('MEMORY_PURGE_FAILED', 'No se pudo borrar la memoria local de Engram.');
}

/**
 * Retira solo las integraciones de memoria que administra Engines y la publicación PATH de Engram.
 * Se ejecuta antes de que `install.mjs --uninstall` aparte o borre el ejecutable del nodo.
 * @param dependencies Rutas y sustituciones de proceso descritas en {@link UninstallDependencies}.
 * @returns El resultado estable que consume el instalador único.
 * @throws MemoryError con `MEMORY_PRESERVATION_FAILED` o `ENGRAM_INTEGRATION_REMOVE_FAILED` si no se puede completar sin riesgo.
 */
export async function uninstallEngramSelf(dependencies: UninstallDependencies): Promise<SelfUninstallResult> {
  const platform = dependencies.platform ?? process.platform;
  const home = dependencies.home ?? homedir();
  const parent = dependencies.forgeHome ?? forge614Home();
  const root = dependencies.forgeHome === undefined ? engramHome() : join(parent, 'engram');
  const binDirectory = dependencies.forgeHome === undefined ? engramBinDirectory() : join(root, 'bin');
  let memoryPath: string;
  try { memoryPath = await ensureMemoryBeforeUninstall(parent, root); }
  catch { throw new MemoryError('MEMORY_PRESERVATION_FAILED', 'No se pudo asegurar una copia completa de la memoria; Engram no se desinstaló.'); }
  try { cleanupOldLaunchers(binDirectory); } catch { /* Se conserva la ejecución del hook aunque no se puedan limpiar restos antiguos. */ }

  const enginesHome = join(parent, 'engines');
  const engines = join(enginesHome, 'bin', platform === 'win32' ? 'forge614-engines.exe' : 'forge614-engines');
  if (safeDirectory(enginesHome)) {
    if (!stat(engines)) throw new MemoryError('ENGRAM_INTEGRATION_REMOVE_FAILED', 'Engines está instalado, pero no se pudo ejecutar para retirar sus integraciones de Engram.');
    const runner = dependencies.runEnginesSelf ?? defaultEnginesSelfRunner;
    let exitCode: number;
    try { exitCode = await runner(engines, []); }
    catch { throw new MemoryError('ENGRAM_INTEGRATION_REMOVE_FAILED', 'Engines no pudo retirar las integraciones de Engram.'); }
    if (exitCode !== 0) throw new MemoryError('ENGRAM_INTEGRATION_REMOVE_FAILED', 'Engines no pudo retirar las integraciones de Engram.');
  }

  try {
    const removeFn = dependencies.removePathPublication ?? ((candidateHome, candidateBinDirectory) =>
      removePathPublication({ home: candidateHome, binDirectory: candidateBinDirectory, platform }));
    await removeFn(home, binDirectory);
  } catch {
    throw new MemoryError('PATH_REMOVE_FAILED', 'No se pudo retirar de forma segura la ruta PATH de Engram.');
  }
  return { integrationsRemoved: true, memoryKept: true, memoryPath, atlasRemains: safeDirectory(join(parent, 'atlas')) !== null };
}

/** Planea y aplica en Engines solo la retirada de las integraciones de memoria de Engram. */
async function defaultEnginesSelfRunner(command: string, args: string[]): Promise<number> {
  const agents = ['claude-code', 'codex'];
  for (const agent of agents) {
    const planned = Bun.spawnSync([command, 'plan', 'memory-remove', '--agent', agent], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    if (planned.exitCode !== 0) return planned.exitCode ?? 1;
    let payload: { plan?: { planId?: string } };
    try { payload = JSON.parse(planned.stdout.toString()); } catch { return 1; }
    const planId = payload.plan?.planId;
    if (!planId) return 1;
    const applied = Bun.spawnSync([command, 'apply', '--plan-id', planId], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    if (applied.exitCode !== 0) return applied.exitCode ?? 1;
  }
  return 0;
}
