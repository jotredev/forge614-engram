import type { Database } from "bun:sqlite";
import { projectIdentity,type Project } from "../../modules/projects";
import { MemoryError } from "../../shared/errors";
import { ecosystemEnabled,recordIdentityEvent } from "./ecosystem-groups";
import { required } from "./memory";
import { schemaFeatures } from "./schema";

export function createProject(db: Database, name: string): Project {
    const displayName = required(name, "name");
    const now = new Date().toISOString();
    const project: Project = { projectId: crypto.randomUUID(), name: displayName, createdAt: now, updatedAt: now };
    db.query("INSERT INTO projects(projectId,name,createdAt,updatedAt) VALUES(?,?,?,?)")
      .run(project.projectId,project.name,now,now);
    return project;
  }

export function getProject(db: Database, projectId: string): Project | null {
    return db.query("SELECT * FROM projects WHERE projectId=?").get(projectIdentity(projectId)) as Project | null;
  }

export function listProjects(db: Database): Project[] {
    return db.query("SELECT * FROM projects ORDER BY name,projectId").all() as Project[];
  }

/** Every folder key bound to a project on this machine. */
export function projectDirectories(db: Database, projectId: string): string[] {
    if ((schemaFeatures(db)?.base ?? 0) < 5) return [];
    return (db.query("SELECT directory FROM project_bindings WHERE projectId=? ORDER BY directory").all(projectIdentity(projectId)) as { directory: string }[]).map(row => row.directory);
  }

export function requireProjectBindings(db: Database): void {
    if ((schemaFeatures(db)?.base ?? 0) < 5) {
      throw new MemoryError("MIGRATION_REQUIRED", "Inicializa Engram para habilitar los vínculos de proyecto.");
    }
  }

export function projectForDirectory(db: Database, directory: string): Project | null {
    requireProjectBindings(db);
    const path = required(directory,"directory");
    return db.query(`SELECT p.* FROM project_bindings b JOIN projects p ON p.projectId=b.projectId
      WHERE b.directory=?`).get(path) as Project | null;
  }

export function resolveProjectDirectory(db: Database, directory: string, name: string, create: boolean, bindingAvailable?: (directory:string)=>boolean): { project: Project | null; created: boolean } {
    requireProjectBindings(db);
    const path = required(directory,"directory"); const displayName = required(name,"name");
    const operation = () => {
      const bound = projectForDirectory(db, path);
      if (bound || !create) return { project: bound, created: false };
      const collision = db.query("SELECT projectId FROM projects WHERE name=? LIMIT 1").get(displayName);
      if (collision) {
        throw new MemoryError("PROJECT_BINDING_REQUIRED","Existe un proyecto con el mismo nombre; se requiere vinculación explícita.");
      }
      if (bindingAvailable) {
        const bindings=db.query("SELECT projectId,directory FROM project_bindings").all() as {projectId:string;directory:string}[];
        const available=new Map<string,boolean>();
        for(const binding of bindings){
          let exists=false;try{exists=bindingAvailable(binding.directory);}catch{/* Unavailable is ambiguous. */}
          available.set(binding.projectId,(available.get(binding.projectId)??false)||exists);
        }
        if([...available.values()].some(exists=>!exists)) {
          throw new MemoryError("PROJECT_BINDING_REQUIRED","Hay proyectos cuyas carpetas registradas no están disponibles; se requiere vinculación explícita con project-bind.");
        }
      }
      const project = createProject(db, displayName);
      db.query("INSERT INTO project_bindings(directory,projectId,createdAt) VALUES(?,?,?)")
        .run(path,project.projectId,new Date().toISOString());
      return { project, created: true };
    };
    return operation();
  }

/** Registers a project that arrives with its own identity (a clone of a repository that carries its identity file). */
export function registerProject(db: Database, projectId: string, name: string): { project: Project; created: boolean } {
    const identity = projectIdentity(projectId); const displayName = required(name, "name");
    // Steady state writes nothing (a read-only connection must work), and the insert itself is one atomic
    // statement because several hosts can start in the same fresh clone at the same moment.
    const existing = getProject(db, identity);
    if (existing) return { project: existing, created: false };
    const now = new Date().toISOString();
    const inserted = db.query("INSERT OR IGNORE INTO projects(projectId,name,createdAt,updatedAt) VALUES(?,?,?,?)").run(identity, displayName, now, now);
    if (inserted.changes === 1 && ecosystemEnabled(db)) recordIdentityEvent(db, { action: "PROJECT_REGISTERED_FROM_FILE", projectId: identity });
    return { project: getProject(db, identity)!, created: inserted.changes === 1 };
  }
