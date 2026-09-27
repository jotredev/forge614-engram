/**
 * Punto de entrada público del paquete (el campo `exports` de `package.json` apunta aquí): reexporta los
 * tipos y funciones de las capas de dominio (`modules`) y de aplicación (`app`), más algunas piezas de
 * infraestructura (rutas y configuración del área de trabajo) que un programa que use Engram como
 * biblioteca necesita para integrarlo, sin exponer el resto de los detalles internos.
 */
export { memoryTypes } from "./modules/memory";
export type { MemoryType,MemoryScope,SearchScope,SaveInput,MemoryVersion,Memory,SearchResult,Confirmation,ConfirmationRequest,MemoryMeta,MemoryMark,SimilarCandidate } from "./modules/memory";
export { memoryProtocol } from "./modules/memory-protocol";
export type { MemoryProtocol } from "./modules/memory-protocol";
export type { Project } from "./modules/projects";
export type { Group,GroupSummary,GroupMembership,IdentityEvent,MembershipSource,ProjectGroup,GroupSource } from "./modules/ecosystem";
export { MemoryError } from "./shared/errors";
export type { Session,SessionEntry,SessionSummary,SessionSaveOptions,SessionSaveResult,SummaryFields,PreviousSession,ParallelSession } from "./modules/sessions";
export type { MemoryPreview,PreviewResult,VersionRead,TimelineInput,TimelineRow,TimelineResult,ContextInput,ContextRow,ContextResult,StartupBlock } from "./modules/search";
export { MemoryStore } from "./app/memory-store";
export { defaultDatabasePath } from "./infrastructure/filesystem/paths";
export { saveProjectMemoryWithSession, startProjectSession } from "./app/project-context";
export { WorkspaceConfig } from "./infrastructure/filesystem/workspace-config";
export type { WorkspaceSettings } from "./modules/workspace";
export { MemoryWorkspace } from "./app/workspace";
export type { GroupBinding, GroupRename, GroupUnbinding, IdentityFilesResult, MemoryMove } from "./app/workspace";
export { inspectMemoryInitialization, previewMemoryInitialization, applyMemoryInitialization } from "./app/initialization";
export type { MemoryInitializationStatus, MemoryInitializationRequest, MemoryInitializationPreview, MemoryInitializationResult } from "./app/initialization";
