/**
 * Este archivo maneja los proyectos guardados en SQLite y su vínculo (binding) con carpetas locales del
 * disco. Existe para que el resto de la capa de infraestructura pueda crear proyectos, consultarlos,
 * listarlos, resolver a qué proyecto pertenece una carpeta y registrar un proyecto que llega con una
 * identidad propia (por ejemplo, el clon de un repositorio que ya trae su archivo de identidad), sin
 * repetir estas reglas en cada lugar que las necesite. Sus piezas principales son: creación y lectura de
 * proyectos (createProject/getProject/listProjects), consulta de las carpetas vinculadas a un proyecto
 * (projectDirectories), comprobación de si el esquema (schema, la versión de la estructura de la base de
 * datos) admite vínculos de proyecto (requireProjectBindings), resolución del proyecto de una carpeta
 * (projectForDirectory/resolveProjectDirectory) y registro de un proyecto que ya trae su propio
 * identificador (registerProject). Desde T3b (D6), resolveProjectDirectory también liga por remoto de
 * Git (usableNormalizedRemote/knownRemotes/annotateRemote) cuando la carpeta llega sin vínculo previo y
 * la base tiene la nube activa: así una carpeta clonada en otra Mac reconoce al proyecto que ya llegó
 * de la nube en vez de crear uno nuevo con el mismo nombre.
 */
import type { Database } from "bun:sqlite";
import { findSecret } from "../../modules/memory";
import { matchProjectByRemote,normalizeRemote,projectIdentity,type Project } from "../../modules/projects";
import { MemoryError } from "../../shared/errors";
import { ecosystemEnabled,recordIdentityEvent } from "./ecosystem-groups";
import { required } from "./memory";
import { cloudEnabled,schemaFeatures } from "./schema";

/**
 * Crea un proyecto nuevo con un identificador generado y las marcas de fecha de creación y actualización.
 * @param db conexión a la base de datos SQLite.
 * @param name nombre visible del proyecto; se recorta (trim) de espacios sobrantes.
 * @returns el proyecto recién creado.
 * @throws MemoryError con código INVALID_INPUT si el nombre está vacío o no es texto.
 */
export function createProject(db: Database, name: string): Project {
    // required valida que sea texto no vacío y sin caracteres nulos, y ya devuelve el nombre recortado.
    const displayName = required(name, "name");
    const now = new Date().toISOString();
    const project: Project = { projectId: crypto.randomUUID(), name: displayName, createdAt: now, updatedAt: now };
    db.query("INSERT INTO projects(projectId,name,createdAt,updatedAt) VALUES(?,?,?,?)")
      .run(project.projectId,project.name,now,now);
    return project;
  }

/**
 * Busca un proyecto por su identificador, validando primero que tenga formato de UUID de proyecto.
 * @param db conexión a la base de datos SQLite.
 * @param projectId identificador del proyecto a buscar.
 * @returns el proyecto encontrado, o null si no existe.
 * @throws MemoryError con código INVALID_INPUT si projectId no es un UUID válido.
 */
export function getProject(db: Database, projectId: string): Project | null {
    return db.query("SELECT * FROM projects WHERE projectId=?").get(projectIdentity(projectId)) as Project | null;
  }

/**
 * Lista todos los proyectos guardados, ordenados por nombre y, en caso de empate, por identificador.
 * @param db conexión a la base de datos SQLite.
 * @returns los proyectos, en orden estable.
 */
export function listProjects(db: Database): Project[] {
    return db.query("SELECT * FROM projects ORDER BY name,projectId").all() as Project[];
  }

/**
 * Devuelve cada carpeta vinculada (binding) a un proyecto en esta máquina.
 * @param db conexión a la base de datos SQLite.
 * @param projectId identificador del proyecto.
 * @returns las rutas de carpeta vinculadas, ordenadas alfabéticamente; vacío si el esquema todavía no
 * admite vínculos de proyecto (nivel base menor que 5).
 */
export function projectDirectories(db: Database, projectId: string): string[] {
    if ((schemaFeatures(db)?.base ?? 0) < 5) return [];
    return (db.query("SELECT directory FROM project_bindings WHERE projectId=? ORDER BY directory").all(projectIdentity(projectId)) as { directory: string }[]).map(row => row.directory);
  }

/**
 * Exige que el esquema admita vínculos de proyecto (carpeta-proyecto) antes de continuar.
 * @param db conexión a la base de datos SQLite.
 * @throws MemoryError con código MIGRATION_REQUIRED si el esquema todavía no los admite (nivel base menor que 5).
 */
export function requireProjectBindings(db: Database): void {
    if ((schemaFeatures(db)?.base ?? 0) < 5) {
      throw new MemoryError("MIGRATION_REQUIRED", "Inicializa Engram para habilitar los vínculos de proyecto.");
    }
  }

/**
 * Busca el proyecto vinculado a una carpeta local.
 * @param db conexión a la base de datos SQLite.
 * @param directory ruta de la carpeta a consultar.
 * @returns el proyecto vinculado, o null si la carpeta no está vinculada a ninguno.
 * @throws MemoryError con código MIGRATION_REQUIRED si el esquema no admite vínculos de proyecto.
 * @throws MemoryError con código INVALID_INPUT si directory está vacío o no es texto.
 */
export function projectForDirectory(db: Database, directory: string): Project | null {
    requireProjectBindings(db);
    const path = required(directory,"directory");
    return db.query(`SELECT p.* FROM project_bindings b JOIN projects p ON p.projectId=b.projectId
      WHERE b.directory=?`).get(path) as Project | null;
  }

/**
 * Normaliza `origin` y lo descarta en silencio si no queda usable: vacío tras normalizar, o con un
 * secreto detectable (D6, "un remoto con un secreto que sobrevive a la normalización no se anota").
 * @param origin Remoto crudo (sin normalizar), tal como lo dio quien llama.
 * @returns El remoto ya normalizado, listo para comparar o guardar; o `null` si no es usable.
 */
function usableNormalizedRemote(origin: string): string | null {
  const normalized = normalizeRemote(origin);
  if (!normalized || findSecret(normalized)) return null;
  return normalized;
}

/**
 * Lee cada remoto ya anotado de `project_remotes`, en la forma que pide `matchProjectByRemote`.
 * @param db conexión a la base de datos SQLite (con la nube ya activa: la tabla existe).
 * @returns un par (projectId, origin) por cada proyecto con remoto anotado.
 */
function knownRemotes(db: Database): { projectId: string; origin: string | null }[] {
  return db.query("SELECT project_id AS projectId, origin FROM project_remotes").all() as { projectId: string; origin: string | null }[];
}

/**
 * Anota (o actualiza) el remoto normalizado de un proyecto en `project_remotes`, sin escribir nada si
 * ya tenía anotado ese mismo valor (D6: "solo si falta o cambió", para no encolar un cambio en cada
 * guardado de un proyecto ya conocido).
 * @param db conexión a la base de datos SQLite (con la nube ya activa).
 * @param projectId proyecto cuyo remoto se anota.
 * @param normalized remoto ya normalizado (ver {@link usableNormalizedRemote}).
 */
function annotateRemote(db: Database, projectId: string, normalized: string): void {
  const current = db.query("SELECT origin FROM project_remotes WHERE project_id=?").get(projectId) as { origin: string } | null;
  if (current && current.origin === normalized) return;
  const now = new Date().toISOString();
  if (!current) db.query("INSERT INTO project_remotes(project_id,origin,updated_at) VALUES(?,?,?)").run(projectId,normalized,now);
  else db.query("UPDATE project_remotes SET origin=?,updated_at=? WHERE project_id=?").run(normalized,now,projectId);
}

/**
 * Resuelve el proyecto de una carpeta: si ya está vinculada, la devuelve; si no y se pide crear, crea un
 * proyecto nuevo y lo vincula a la carpeta, salvo que ya exista otro proyecto con el mismo nombre (en ese
 * caso exige una vinculación explícita) o que alguna carpeta ya vinculada no esté disponible según la
 * función de comprobación opcional.
 *
 * D6 (identidad de proyecto por remoto de Git, T3b): con la nube activa, `create` en true y un `origin`
 * usable, y solo si la carpeta todavía no está ligada, se busca antes que la comprobación de nombre
 * repetido un proyecto ya conocido con ese mismo remoto (`matchProjectByRemote`); si hay exactamente
 * uno, esta carpeta se liga a él en vez de crear uno nuevo, y el error de nombre repetido no aplica
 * (es justo el caso de una carpeta que llegó de otra Mac con un proyecto del mismo nombre). Gane la
 * carpeta un vínculo ya existente, uno por remoto, o uno recién creado, el remoto del proyecto
 * resultante se anota al final (o se actualiza, si cambió). Sin nube, la tabla ni se consulta.
 * @param db conexión a la base de datos SQLite.
 * @param directory ruta de la carpeta a resolver.
 * @param name nombre a usar si hay que crear el proyecto.
 * @param create si es true, crea el proyecto y el vínculo cuando la carpeta todavía no tiene uno.
 * @param bindingAvailable función opcional que dice si la carpeta de un vínculo existente sigue disponible
 * en el disco (por ejemplo, montada o presente); si falta información se trata como no disponible.
 * @param origin remoto de Git crudo (sin normalizar) de la carpeta, o `null`/`undefined` si no se
 * conoce; solo se usa cuando `create` es true y la base tiene la nube activa.
 * @returns el proyecto resuelto (o null si no existía y no se pidió crear) y si se creó uno nuevo.
 * @throws MemoryError con código MIGRATION_REQUIRED si el esquema no admite vínculos de proyecto.
 * @throws MemoryError con código INVALID_INPUT si directory o name están vacíos o no son texto.
 * @throws MemoryError con código PROJECT_BINDING_REQUIRED si ya existe un proyecto con el mismo nombre
 * y ningún remoto coincidente lo evitó, o si hay proyectos cuyas carpetas registradas no están disponibles.
 */
export function resolveProjectDirectory(db: Database, directory: string, name: string, create: boolean,
    bindingAvailable?: (directory:string)=>boolean, origin?: string | null): { project: Project | null; created: boolean } {
    requireProjectBindings(db);
    const path = required(directory,"directory"); const displayName = required(name,"name");
    const operation = () => {
      // Sin pedir crear, es una simple lectura: ni se busca por remoto ni se anota nada.
      const bound = projectForDirectory(db, path);
      if (!create) return { project: bound, created: false };
      // El remoto solo es usable con la nube activa (la tabla existe) y si sobrevive a la normalización y al filtro de secretos.
      const usableRemote = cloudEnabled(db) && origin ? usableNormalizedRemote(origin) : null;
      let project = bound;
      let created = false;
      if (!project) {
        // Solo si la carpeta no está ligada tiene sentido buscar, por su remoto, un proyecto que ya llegó de otra Mac.
        const matchedId = usableRemote ? matchProjectByRemote(usableRemote, knownRemotes(db)) : null;
        const matched = matchedId ? getProject(db, matchedId) : null;
        if (matched) {
          // Coincidencia por remoto: se liga sin pasar por la comprobación de nombre repetido (D6, ese es justo su caso de uso).
          db.query("INSERT INTO project_bindings(directory,projectId,createdAt) VALUES(?,?,?)")
            .run(path,matched.projectId,new Date().toISOString());
          project = matched;
        } else {
          // Sin coincidencia por remoto: el flujo de hoy, sin cambios.
          // Dos proyectos distintos no pueden compartir el mismo nombre visible sin una vinculación explícita.
          const collision = db.query("SELECT projectId FROM projects WHERE name=? LIMIT 1").get(displayName);
          if (collision) {
            throw new MemoryError("PROJECT_BINDING_REQUIRED","Existe un proyecto con el mismo nombre; se requiere vinculación explícita.");
          }
          if (bindingAvailable) {
            // Se revisa cada vínculo carpeta-proyecto existente: un proyecto cuenta como disponible si al
            // menos una de sus carpetas registradas responde que existe.
            const bindings=db.query("SELECT projectId,directory FROM project_bindings").all() as {projectId:string;directory:string}[];
            const available=new Map<string,boolean>();
            for(const binding of bindings){
              let exists=false;try{exists=bindingAvailable(binding.directory);}catch{/* Si la comprobación falla, la disponibilidad es ambigua: se trata como no disponible. */}
              available.set(binding.projectId,(available.get(binding.projectId)??false)||exists);
            }
            // Si algún proyecto quedó sin ninguna carpeta disponible, crear uno nuevo a ciegas sería arriesgado.
            if([...available.values()].some(exists=>!exists)) {
              throw new MemoryError("PROJECT_BINDING_REQUIRED","Hay proyectos cuyas carpetas registradas no están disponibles; se requiere vinculación explícita con project-bind.");
            }
          }
          // Ninguna de las comprobaciones anteriores bloqueó la creación: se crea el proyecto y se vincula la carpeta.
          project = createProject(db, displayName);
          db.query("INSERT INTO project_bindings(directory,projectId,createdAt) VALUES(?,?,?)")
            .run(path,project.projectId,new Date().toISOString());
          created = true;
        }
      }
      // D6: se anota el remoto del proyecto resultante (ligado de antes, ligado por remoto o recién creado), si hay uno usable.
      if (usableRemote) annotateRemote(db, project!.projectId, usableRemote);
      return { project, created };
    };
    return operation();
  }

/**
 * Registra un proyecto que llega con su propia identidad (por ejemplo, el clon de un repositorio que ya
 * trae su archivo de identidad), o devuelve el proyecto existente si ya estaba registrado.
 * @param db conexión a la base de datos SQLite.
 * @param projectId identificador propio que ya trae el proyecto.
 * @param name nombre a usar si hay que crearlo.
 * @returns el proyecto (existente o recién creado) y si se creó en esta llamada.
 * @throws MemoryError con código INVALID_INPUT si projectId no es un UUID válido o name está vacío.
 */
export function registerProject(db: Database, projectId: string, name: string): { project: Project; created: boolean } {
    const identity = projectIdentity(projectId); const displayName = required(name, "name");
    // En estado ya estable no se escribe nada (una conexión de solo lectura debe poder llamarla), y la
    // inserción es un único paso atómico porque varios equipos (hosts) pueden arrancar en el mismo clon
    // recién hecho al mismo tiempo.
    const existing = getProject(db, identity);
    if (existing) return { project: existing, created: false };
    const now = new Date().toISOString();
    const inserted = db.query("INSERT OR IGNORE INTO projects(projectId,name,createdAt,updatedAt) VALUES(?,?,?,?)").run(identity, displayName, now, now);
    if (inserted.changes === 1 && ecosystemEnabled(db)) recordIdentityEvent(db, { action: "PROJECT_REGISTERED_FROM_FILE", projectId: identity });
    return { project: getProject(db, identity)!, created: inserted.changes === 1 };
  }
