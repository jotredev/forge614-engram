/**
 * Lee y escribe la configuración global privada de Engram (`~/.forge614/engram/.env` o el equivalente
 * configurado): decide si el almacenamiento usa solo SQLite o SQLite con réplica hacia PostgreSQL, y
 * guarda la URL de PostgreSQL y el id de instalación cuando aplica. Cada operación comprueba que la
 * carpeta y el archivo sean privados del usuario actual (carpeta `0700`, archivo `0600`) y rechaza sin
 * modificar nada si detecta una configuración antigua por proyecto (`projects/`) o un formato no
 * reconocido. La usan, entre otros, `src/app/workspace.ts`, `src/app/setup.ts`,
 * `src/app/initialization.ts`, `src/app/synchronization.ts`, `src/app/index.ts`, `src/index.ts` y varias
 * pruebas de integración de `src/interfaces`.
 */
import { chmodSync, closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { createHash } from "node:crypto";
import { postgresOptions } from "../postgres/replica";
import { isAbsolute, join, resolve } from "node:path";
import { MemoryError } from "../../shared/errors";
import { forge614Home, userStorageDirectory } from "./paths";
import { EngramProductHome } from "./product-home";

export type { WorkspaceSettings } from "../../modules/workspace";
import type { WorkspaceSettings } from "../../modules/workspace";
/**
 * Lanza el error estándar de configuración inválida o inaccesible.
 * @param code Código de máquina del fallo; por defecto `CONFIG_INVALID`.
 * @throws MemoryError siempre, con el código dado.
 */
function failure(code = "CONFIG_INVALID"): never {
  throw new MemoryError(code, "Configuración global inválida o inaccesible. Comprueba su formato, propietario y permisos (carpeta 700, archivo 600), sin compartir su contenido.");
}
/**
 * Comprueba si un error de sistema de archivos capturado tiene el código de error dado.
 * @param error Valor capturado de un `catch`.
 * @param code Código de error de Node esperado (p. ej. `"ENOENT"`).
 * @returns `true` si el error tiene ese código.
 */
function errno(error: unknown, code: string): boolean { return (error as NodeJS.ErrnoException)?.code === code; }
/**
 * Comprueba que una ruta pertenece al usuario que ejecuta el proceso actual.
 * @param stat Resultado de `lstatSync` sobre la ruta a comprobar.
 * @returns `true` si no hay forma de comprobar el dueño (plataformas sin `process.getuid`) o si coincide
 * con el usuario actual.
 */
function ownedByCurrentUser(stat: Stats): boolean { return typeof process.getuid !== "function" || stat.uid === process.getuid(); }
/**
 * Comprueba que una ruta es privada: sin permisos para grupo ni otros (`0o077` en cero) y del usuario actual.
 * En Windows (`win32`) los bits de modo no se comparan porque el sistema no tiene permisos de grupo y otros
 * que se mapeen igual; solo exige que sea del usuario actual.
 * @param stat Resultado de `lstatSync` sobre la ruta a comprobar.
 * @returns `true` si la ruta es privada del usuario actual.
 */
function privateOwned(stat: Stats): boolean { return (process.platform === "win32" || (stat.mode & 0o077) === 0) && ownedByCurrentUser(stat); }

/**
 * Representa el único archivo de configuración privado de Engram por instalación (no por proyecto): no
 * carga variables de entorno adicionales ni evalúa nada como shell, solo un formato fijo de líneas
 * `CLAVE="valor"`.
 */
export class WorkspaceConfig {
  readonly root: string;
  /**
   * @param root Carpeta donde vive `.env`; por defecto {@link userStorageDirectory}.
   * @throws MemoryError con código `INVALID_INPUT` si `root` no es una ruta absoluta válida o contiene un
   * carácter de control.
   */
  constructor(root = userStorageDirectory()) {
    if (typeof root !== "string" || !isAbsolute(root) || /[\x00-\x1f\x7f]/.test(root)) {
      throw new MemoryError("INVALID_INPUT", "La carpeta del usuario requiere una ruta absoluta válida.");
    }
    this.root = resolve(root);
  }
  /** Ruta de la base de datos SQLite asociada a esta carpeta de configuración. */
  get databasePath(): string { return join(this.root, "engram.db"); }

  /**
   * Prepara la carpeta de configuración: si es la carpeta por defecto de Engram, primero migra cualquier
   * archivo antiguo de la carpeta compartida de Forge614; luego crea y asegura la carpeta con permisos
   * privados.
   * @throws MemoryError si la carpeta no se puede crear o dejar en un estado privado válido, o si contiene
   * configuración antigua por proyecto.
   */
  prepare(): void {
    if (this.root === userStorageDirectory()) new EngramProductHome(forge614Home(), this.root).migrateLegacyWorkspace();
    this.directory(true, true);
  }
  /**
   * Restringe los permisos de una carpeta raíz ya existente y propiedad del usuario normal; nunca la crea.
   * @throws MemoryError si la carpeta no existe, no es del usuario actual, o no se puede dejar privada.
   */
  repairExistingRoot(): void { this.directory(false, true); }

  /**
   * Valida (y opcionalmente crea o repara) la carpeta raíz de configuración, y rechaza si detecta una
   * subcarpeta `projects` heredada de un formato de configuración por proyecto anterior a esta versión.
   * @param create Si es `true`, crea la carpeta con permisos `0o700` si falta.
   * @param repair Si es `true` y la carpeta tiene permisos más abiertos que `0o700`, intenta corregirlos.
   * @returns `true` si la carpeta existe (o se creó) y es válida; `false` solo cuando `create` es `false`
   * y la carpeta no existe.
   * @throws MemoryError con código `LEGACY_CONFIG` si existe `projects/` dentro de la carpeta raíz; con
   * `CONFIG_INVALID` (vía {@link failure}) si la carpeta no se puede crear, no es una carpeta privada del
   * usuario actual, o no queda así tras intentar repararla.
   */
  private directory(create: boolean, repair: boolean): boolean {
    if (create) {
      try { mkdirSync(this.root, { recursive: true, mode: 0o700 }); }
      catch { failure(); }
    }
    try {
      const stat = lstatSync(this.root);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !ownedByCurrentUser(stat)) failure();
      if (repair && (stat.mode & 0o077) !== 0) chmodSync(this.root, 0o700);
      const repaired = lstatSync(this.root);
      if (!repaired.isDirectory() || repaired.isSymbolicLink() || !privateOwned(repaired)) failure();
    } catch (error) {
      if (!create && errno(error, "ENOENT")) return false;
      failure();
    }
    try {
      lstatSync(join(this.root, "projects"));
      throw new MemoryError("LEGACY_CONFIG", "Se detectó configuración antigua por proyecto. No se modificó. Su conversión debe ser explícita; no se importará ni eliminará automáticamente.");
    } catch (error) {
      if (error instanceof MemoryError) throw error;
      if (!errno(error, "ENOENT")) failure();
    }
    return true;
  }

  /**
   * Comprueba si ya existe una configuración guardada, sin crear ni modificar nada.
   * @returns `true` si la carpeta y el archivo `.env` existen; `false` si falta cualquiera de los dos.
   * @throws MemoryError si la carpeta existe pero no es válida, o si el archivo existe pero no se puede
   * inspeccionar.
   */
  exists(): boolean {
    if (!this.directory(false, false)) return false;
    try { lstatSync(join(this.root, ".env")); return true; }
    catch (error) { if (errno(error, "ENOENT")) return false; return failure(); }
  }

  /**
   * Lee y valida la configuración guardada, reconociendo tres formatos: solo SQLite (versión 2, dos
   * líneas exactas), SQLite con réplica a PostgreSQL (versión 3, con `POSTGRES_URL` y, opcionalmente,
   * `FORGE614_ENGRAM_INSTALLATION_ID`). Cualquier línea, clave duplicada o combinación fuera de esos tres
   * formatos exactos se rechaza.
   * @returns La configuración reconocida ({@link WorkspaceSettings}).
   * @throws MemoryError con código `CONFIG_NOT_FOUND` si la carpeta o el archivo no existen; con
   * `CONFIG_INVALID` (vía {@link failure}) si el archivo no es un archivo regular privado del usuario
   * actual, supera 16 KiB, tiene una línea que no cumple `CLAVE="valor"`, una clave repetida, un valor que
   * no es una cadena JSON válida, o no encaja en ninguno de los tres formatos reconocidos.
   */
  read(): WorkspaceSettings {
    if (!this.directory(false, false)) failure("CONFIG_NOT_FOUND");
    let fd: number | undefined;
    try {
      fd = openSync(join(this.root, ".env"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd);
      if (!stat.isFile() || !privateOwned(stat) || stat.size > 16384) failure();
      const values = new Map<string, string>();
      // Cada línea no vacía ni comentada debe tener la forma exacta CLAVE="valor" (valor como cadena JSON), sin claves repetidas.
      for (const line of readFileSync(fd, "utf8").split(/\r?\n/)) {
        if (!line.trim() || line.trimStart().startsWith("#")) continue;
        const match = /^([A-Z0-9_]+)=(".*")$/.exec(line);
        if (!match || values.has(match[1]!)) failure();
        const value: unknown = JSON.parse(match[2]!);
        if (typeof value !== "string") failure();
        values.set(match[1]!, value);
      }
      // Formato v3 completo: SQLite con réplica a PostgreSQL y un id de instalación explícito.
      if(values.size===4 && values.get("FORMAT_VERSION")==="3" && values.get("STORAGE")==="sqlite" && values.has("POSTGRES_URL") && values.has("FORGE614_ENGRAM_INSTALLATION_ID")) {
        const postgresUrl=values.get("POSTGRES_URL")!;postgresOptions(postgresUrl);
        return {storage:"sqlite",postgresUrl,installationId:values.get("FORGE614_ENGRAM_INSTALLATION_ID")!};
      }
      // Formato v3 sin id de instalación todavía asignado.
      if(values.size===3 && values.get("FORMAT_VERSION")==="3" && values.get("STORAGE")==="sqlite" && values.has("POSTGRES_URL")) {
        const postgresUrl=values.get("POSTGRES_URL")!;postgresOptions(postgresUrl);return {storage:"sqlite",postgresUrl};
      }
      // Formato v3 dejado por "cloud off" (D9): id de instalación conservado, sin POSTGRES_URL (la nube está apagada, pero la base sigue en nivel 12 con su cola).
      if(values.size===3 && values.get("FORMAT_VERSION")==="3" && values.get("STORAGE")==="sqlite" && values.has("FORGE614_ENGRAM_INSTALLATION_ID") && !values.has("POSTGRES_URL")) {
        return {storage:"sqlite",installationId:values.get("FORGE614_ENGRAM_INSTALLATION_ID")!};
      }
      // Formato v2: solo SQLite local, sin PostgreSQL; debe ser exactamente estas dos claves.
      if (values.size !== 2 || values.get("FORMAT_VERSION") !== "2" || values.get("STORAGE") !== "sqlite") failure();
      return { storage: "sqlite" };
    } catch (error) {
      if (errno(error, "ENOENT")) failure("CONFIG_NOT_FOUND");
      return failure();
    } finally { if (fd !== undefined) closeSync(fd); }
  }

  /**
   * Calcula una huella de la configuración actual, para detectar cambios concurrentes antes de escribir.
   * @returns El hash SHA-256 en hexadecimal del contenido de `.env`, o `null` si no hay configuración
   * guardada todavía.
   * @throws MemoryError si la configuración existe pero no es válida o no se puede leer.
   */
  revision(): string | null {
    if(!this.exists()) return null;
    this.read();
    const fd=openSync(join(this.root,".env"),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try {
      const stat=fstatSync(fd);if(!stat.isFile()||!privateOwned(stat)||stat.size>16384) failure();
      return createHash("sha256").update(readFileSync(fd)).digest("hex");
    } finally {closeSync(fd);}
  }

  /**
   * Reemplazo explícito de la configuración, pensado solo para el flujo de `setup`: protegido contra
   * escritores concurrentes mediante un archivo de candado, y contra cambios hechos entre que se leyó la
   * huella `expected` y este llamado.
   * @param url URL de PostgreSQL a usar como réplica, o `null` para volver a SQLite sin réplica; si no es
   * `null`, se valida con {@link postgresOptions} antes de tocar nada.
   * @param expected Huella de {@link revision} que se esperaba encontrar; si no coincide, se rechaza sin
   * escribir.
   * @param installationId Id de instalación (D9) a dejar escrito; si se omite, se conserva el que ya
   * hubiera en la configuración actual (así una llamada de `setup`/`init`, que no sabe nada de nubes,
   * nunca borra el id que `cloud on` ya hubiera generado). Un `null` explícito lo quita.
   * @throws MemoryError con código `CONFIG_BUSY` si otra configuración está en curso (el candado ya
   * existe); con `CONFIG_CHANGED` si la configuración cambió desde que se leyó `expected`.
   */
  configurePostgres(url:string|null,expected:string|null,installationId?:string|null):void {
    if(url!==null) postgresOptions(url);
    this.prepare();
    const lock=join(this.root,".config-lock");let lockFd:number;
    try {lockFd=openSync(lock,"wx",0o600);} catch {throw new MemoryError("CONFIG_BUSY","Otra configuración está en curso. No se reemplazó el archivo.");}
    const temporary=join(this.root,`.env-${crypto.randomUUID()}.tmp`);let ownsTemporary=false;
    try {
      if(this.revision()!==expected) throw new MemoryError("CONFIG_CHANGED","La configuración cambió mientras respondías. Vuelve a ejecutar setup.");
      const current=expected!==null?this.read():null;
      // Sin id explícito, se conserva el que ya hubiera (o ninguno); con id explícito (incluido null), manda ese.
      const effectiveId=installationId!==undefined?installationId:(current?.installationId??null);
      if(current && (current.postgresUrl??null)===url && (current.installationId??null)===effectiveId) return;
      const content=url===null
        ?(effectiveId===null?'FORMAT_VERSION="2"\nSTORAGE="sqlite"\n':`FORMAT_VERSION="3"\nSTORAGE="sqlite"\nFORGE614_ENGRAM_INSTALLATION_ID=${JSON.stringify(effectiveId)}\n`)
        :(effectiveId===null?`FORMAT_VERSION="3"\nSTORAGE="sqlite"\nPOSTGRES_URL=${JSON.stringify(url)}\n`:`FORMAT_VERSION="3"\nSTORAGE="sqlite"\nPOSTGRES_URL=${JSON.stringify(url)}\nFORGE614_ENGRAM_INSTALLATION_ID=${JSON.stringify(effectiveId)}\n`);
      const fd=openSync(temporary,"wx",0o600);ownsTemporary=true;
      try {writeFileSync(fd,content);fsyncSync(fd);} finally {closeSync(fd);}
      // Sin configuración previa (expected null), publica con enlace duro (nunca reemplaza algo que otro haya creado primero); si ya había una, renombra sobre ella tras confirmar la huella.
      if(expected===null) linkSync(temporary,join(this.root,".env"));
      else renameSync(temporary,join(this.root,".env"));
    } finally {
      if(ownsTemporary) {try {unlinkSync(temporary);} catch(error) {if(!errno(error,"ENOENT")) throw error;}}
      closeSync(lockFd);unlinkSync(lock);
    }
  }

  /**
   * Asegura que exista una configuración mínima de solo SQLite, sin tocar una ya existente aunque sea de
   * otro formato compatible: si el archivo ya existe (el enlace duro falla con `EEXIST`), conserva sus
   * bytes actuales y solo los valida con {@link read}.
   * @throws MemoryError si la carpeta no se puede preparar, o si un archivo `.env` existente no es válido.
   */
  save(): void {
    this.prepare();
    const destination = join(this.root, ".env");
    const content = 'FORMAT_VERSION="2"\nSTORAGE="sqlite"\n';
    const temporary = join(this.root, `.env-${crypto.randomUUID()}.tmp`);
    let fd: number | undefined;
    let ownsTemporary = false;
    try {
      fd = openSync(temporary, "wx", 0o600); ownsTemporary = true;
      writeFileSync(fd, content); fsyncSync(fd); closeSync(fd); fd = undefined;
      try { linkSync(temporary, destination); }
      catch (error) {
        if (!errno(error, "EEXIST")) failure();
        this.read(); // Una configuración compatible ya existente se conserva byte a byte.
      }
    } catch (error) {
      if (error instanceof MemoryError) throw error;
      failure();
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (ownsTemporary) unlinkSync(temporary);
    }
  }
}
