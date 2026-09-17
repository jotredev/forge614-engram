import type { Database } from "bun:sqlite";
import { projectIdentity,type Project } from "../../modules/projects";
import { MemoryError } from "../../shared/errors";
import { required } from "./memory";

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

export function requireAssistantIntegration(db: Database): void {
    const version = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version !== 5 && version !== 6 && version !== 7) {
      throw new MemoryError("MIGRATION_REQUIRED", "Habilita primero la integración de asistentes con integration-enable.");
    }
  }

export function projectForDirectory(db: Database, directory: string): Project | null {
    requireAssistantIntegration(db);
    const path = required(directory,"directory");
    return db.query(`SELECT p.* FROM project_bindings b JOIN projects p ON p.projectId=b.projectId
      WHERE b.directory=?`).get(path) as Project | null;
  }

export function resolveProjectDirectory(db: Database, directory: string, name: string, create: boolean, bindingAvailable?: (directory:string)=>boolean): { project: Project | null; created: boolean } {
    requireAssistantIntegration(db);
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
