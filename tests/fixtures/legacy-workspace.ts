/**
 * Accesorio (fixture) que construye un espacio de trabajo (workspace) configurado en el nivel de
 * esquema más antiguo soportado, para las pruebas que necesitan partir de una base así en vez de
 * una recién creada por `MemoryWorkspace.init()`.
 */
import { MemoryStore } from "../../src/app/memory-store";
import type { WorkspaceConfig } from "../../src/infrastructure/filesystem/workspace-config";

/**
 * Construye una base de datos de espacio de trabajo configurada (con su `.env` presente) en el
 * nivel de esquema soportado más antiguo (3: todavía sin vínculos de proyecto, sesiones, refuerzo,
 * ecosistema ni estructura de inteligencia) -- exactamente como se ve en disco una instalación
 * real anterior a la inteligencia de memoria.
 *
 * Como `MemoryWorkspace.init()` ahora hace nacer cualquier base nueva ya directamente en el
 * esquema 11 (inteligencia de memoria, que ya incluye sesiones y refuerzo), las pruebas de una
 * conducta que solo tiene sentido para una base configurada más antigua -- `init()` nunca migra
 * una base ya existente; la inscripción a refuerzo/inteligencia migra explícitamente una base
 * antigua; la configuración pregunta si activar el refuerzo -- deben partir de una base
 * construida con este ayudante en vez de un `MemoryWorkspace.init()` recién creado.
 *
 * `populate` corre contra el almacén ya abierto antes de cerrar la base de nivel 3 y guardar la
 * configuración, por ejemplo para crear proyectos o memorias, o para adelantar funciones
 * concretas (`store.enableProjectBindings()`, `store.enableSessions()`, `store.enableEcosystem()`, ...)
 * mientras se dejan otras -- sobre todo el refuerzo y la inteligencia -- apagadas.
 */
export function legacyConfiguredWorkspace(config: WorkspaceConfig, populate?: (store: MemoryStore) => void): void {
  config.prepare();
  const store = new MemoryStore(config.databasePath);
  try { populate?.(store); }
  finally { store.close(); }
  config.save();
}
