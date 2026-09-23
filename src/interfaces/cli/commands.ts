import { MemoryWorkspace, syncWorkspace, bindProjectContext, resolveProjectContext, startProjectSessionWithNotices, uninstallEngram, updateEngram, applyMemoryInitialization, previewMemoryInitialization, inspectMemoryInitialization, readProjectContext, readStartupContext } from "../../app";
import type { EngramUpdateResult } from "../../app";
import { MemoryError } from "../../shared/errors";
import { memoryTypes, type SaveInput, type SearchScope } from "../../modules/memory";
import { memoryProtocol } from "../../modules/memory-protocol";
import { projectIdentity } from "../../modules/projects";
import { initTerminal } from "../terminal/setup";
import { watchSync } from "../terminal/sync-watch";
import { invalid, integer, nonnegative, type ParsedCommand } from "./arguments";

export function updateResultJson(result: EngramUpdateResult): string {
  return JSON.stringify(result);
}

export async function runUpdateCommand(
  json: boolean,
  currentVersion: string,
  update: () => Promise<EngramUpdateResult> = () => updateEngram(currentVersion, { quiet: json }),
  print: (value: string) => void = console.log,
): Promise<void> {
  const result = await update();
  if (json) print(updateResultJson(result));
}

export async function dispatch({command,values,need}:ParsedCommand, currentVersion = "0.0.0"):Promise<void> {
  if (command === "init" && !values.has("json")) { await initTerminal(); return; }
  if (command === "memory-protocol") {
    const requested = values.get("protocol-version");
    console.log(JSON.stringify(memoryProtocol(requested === "3" ? 3 : requested === "2" ? 2 : 1), null, 2));
    return;
  }
  if (command === "update") {
    await runUpdateCommand(values.has("json"), currentVersion);
    return;
  }
  if (command === "uninstall") {
    const result=await uninstallEngram({confirmation:need("confirm")},{executable:process.execPath});
    console.log(JSON.stringify(result,null,2));return;
  }
  if (command === "sync") {console.log(JSON.stringify(await syncWorkspace(undefined,{upgradeFormat:values.has("upgrade-format")}),null,2));return;}
  if(command==="sync-watch"&&values.has("upgrade-format"))invalid("sync-watch no acepta --upgrade-format.");
  if (command === "sync-watch") {await watchSync(values.has("interval")?integer(need("interval"),"interval",3600):30);return;}
  // Loaded lazily: the MCP SDK (and zod, including its 64-file locale barrel) has no
  // reason to be parsed for any command other than "mcp" -- see forge614-ai review of
  // the v1.5.3 CLI hang investigation, experiment 4 (a hung child was caught mid-load
  // of a zod locale file for a command that never uses MCP at all).
  if (command === "mcp") { const { startMcp } = await import("../mcp/server"); await startMcp(); return; }
  const workspace = new MemoryWorkspace();
  if(command==="sessions-enable"){
    workspace.init();const store=workspace.open();try{store.enableSessions();}finally{store.close();}
    console.log(JSON.stringify({enabled:true,schema:6},null,2));return;
  }
  if(command==="reinforcement-enable"){
    workspace.init();const store=workspace.open();try{store.enableSearchReinforcement();}finally{store.close();}
    console.log(JSON.stringify({enabled:true,schema:7},null,2));return;
  }
  if (command === "project-bind") {
    const store = workspace.open();
    try { console.log(JSON.stringify(bindProjectContext(store,need("directory"),projectIdentity(need("project-id"))),null,2)); }
    finally { store.close(); }
    return;
  }
  if (command.startsWith("group-")) {
    let result: Record<string, unknown>;
    switch (command) {
      case "group-create": result = { group: workspace.createGroup(need("name")) }; break;
      case "group-list": result = { groups: workspace.listGroups() }; break;
      case "group-bind": {
        const projectId = projectIdentity(need("project-id"));
        const bound = workspace.bindProjectToGroup(projectId, need("group"));
        result = { projectId, group: bound.group, changed: bound.changed, identityFilesUpdated: bound.identityFiles.updated }; break;
      }
      case "group-unbind": {
        const projectId = projectIdentity(need("project-id"));
        const unbound = workspace.unbindProject(projectId);
        result = { projectId, unbound: unbound.unbound, identityFilesUpdated: unbound.identityFiles.updated }; break;
      }
      default: {
        const renamed = workspace.renameGroup(need("group"), need("name"));
        result = { group: renamed.group, identityFilesUpdated: renamed.identityFiles.updated };
      }
    }
    console.log(JSON.stringify({ schemaVersion: 1, ...result }, null, 2)); return;
  }
  if (command === "memory-move") {
    const from = values.get("scope") ?? "project";
    if (from !== "project" && from !== "shared") invalid("scope debe ser project o shared (el origen del recuerdo).");
    if (need("to-scope") !== "ecosystem") invalid("to-scope solo acepta ecosystem.");
    if (from === "shared" && values.has("project-id")) invalid("scope shared no acepta --project-id.");
    if (from === "project" && !values.has("project-id")) invalid("Un recuerdo de proyecto requiere --project-id.");
    const moved = workspace.moveMemory(need("id"), from === "shared" ? null : projectIdentity(need("project-id")), need("group"));
    console.log(JSON.stringify({ schemaVersion: 1, ...moved }, null, 2)); return;
  }
  if (command === "init" || command.startsWith("project-")) {
    let result: unknown;
    switch (command) {
      case "init": {
        if (values.has("postgres-url")) {
          const request = { postgresUrl: need("postgres-url"), enableReinforcement: false };
          const preview = await previewMemoryInitialization(request);
          result = (await applyMemoryInitialization(request, preview.expectedRevision)).status;
        } else {
          workspace.init(); const store=workspace.open();
          let project: unknown;
          try {
            store.enableProjectBindings();
            // Binding a folder is explicit and non-interactive: it registers the project (by the identity
            // file when the repository carries one) and writes .forge614/project.json silently.
            if (values.has("directory")) project = resolveProjectContext(store, need("directory"), true);
          }
          finally { store.close(); }
          result = values.has("directory") ? { ...inspectMemoryInitialization(), project } : inspectMemoryInitialization();
        }
        break;
      }
      case "project-create": result = workspace.createProject(need("name")); break;
      case "project-list": result = workspace.listProjects(); break;
      case "project-rename": result = workspace.renameProject(projectIdentity(need("project-id")),need("name")); break;
    }
    console.log(JSON.stringify(result,null,2)); return;
  }
  if(command==="session-start"){
    const store=workspace.open();try{const started=startProjectSessionWithNotices(store,need("directory"),need("session-id"));console.log(JSON.stringify(started.notices.length?{...started.session,notices:started.notices}:started.session,null,2));}finally{store.close();}return;
  }
  if(command==="session-end"){
    const store=workspace.open();try{console.log(JSON.stringify(store.endSession(projectIdentity(need("project-id")),need("session-id")),null,2));}finally{store.close();}return;
  }
  if(command==="session-summary"){
    let summary:unknown;try{summary=JSON.parse(need("summary-json"));}catch{invalid("--summary-json debe ser JSON válido.");}
    const keys=["goal","instructions","discoveries","accomplishments","nextSteps","files"];
    if(!summary||typeof summary!=="object"||Array.isArray(summary)||Object.keys(summary).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(summary,key)))invalid("--summary-json requiere exactamente goal, instructions, discoveries, accomplishments, nextSteps y files.");
    const expected=values.has("expected-version")?integer(need("expected-version"),"expected-version"):undefined;
    const store=workspace.open();try{console.log(JSON.stringify(store.saveSessionSummary(projectIdentity(need("project-id")),need("session-id"),summary as any,{requestKey:need("request-key"),...(expected?{expectedVersion:expected}:{})}),null,2));}finally{store.close();}return;
  }
  if(command==="timeline"){
    const store=workspace.open(true);try{console.log(JSON.stringify(store.timeline(projectIdentity(need("project-id")),{sessionId:need("session-id"),memoryId:need("id"),version:integer(need("version"),"version"),...(values.has("before")?{before:nonnegative(need("before"),"before",20)}:{}),...(values.has("after")?{after:nonnegative(need("after"),"after",20)}:{})}),null,2));}finally{store.close();}return;
  }
  if(command==="context"){
    const scope=values.get("scope")??"project";if(scope!=="project"&&scope!=="shared"&&scope!=="ecosystem")invalid("scope debe ser project, shared o ecosystem.");
    if(scope==="shared"&&values.has("project-id"))invalid("scope shared no acepta --project-id.");
    if(scope==="ecosystem"&&values.has("project-id"))invalid("scope ecosystem no acepta --project-id.");
    if(scope==="ecosystem"&&!values.has("group"))invalid("scope ecosystem requiere --group.");
    if(scope!=="ecosystem"&&values.has("group"))invalid("--group solo se acepta con --scope ecosystem.");
    const projectId=scope==="project"?projectIdentity(need("project-id")):null;
    const options={compact:values.has("compact"),...(values.has("max-bytes")?{maxBytes:integer(need("max-bytes"),"max-bytes",65536)}:{})};
    const store=workspace.open(true);try{console.log(JSON.stringify(scope==="ecosystem"?store.contextForGroup(store.resolveGroup(need("group")).id,options):projectId===null?store.context(null,options):readProjectContext(store,projectId,options),null,2));}finally{store.close();}return;
  }
  if(command==="startup-context"){
    const directory=need("directory");
    // Read-only first: the common case writes nothing to the base, and an untouched base keeps its exact
    // on-disk footprint. Only when the identity flow must register something (a clone, a group) is it repeated
    // writable; that flow is idempotent, so running it again is safe.
    const readonlyStore=workspace.open(true);
    try{console.log(JSON.stringify(readStartupContext(readonlyStore,directory),null,2));return;}
    catch(error){if((error as {code?:unknown})?.code!=="SQLITE_READONLY")throw error;}
    finally{readonlyStore.close();}
    const store=workspace.open();try{console.log(JSON.stringify(readStartupContext(store,directory),null,2));}finally{store.close();}return;
  }
  // Complete argument validation before reading config or opening any database.
  const scope = values.get("scope") ?? (command === "search" ? "all" : "project");
  const projectId = values.has("project-id") ? projectIdentity(need("project-id")) : null;
  const groupReference = values.get("group");
  if (groupReference !== undefined && scope !== "ecosystem") invalid("--group solo se acepta con --scope ecosystem.");
  if (command === "search") {
    if (!["all","project","shared","ecosystem"].includes(scope)) invalid("scope debe ser all, project, shared o ecosystem.");
    if (scope === "ecosystem") {
      if (groupReference === undefined && projectId === null) invalid("scope ecosystem requiere --group, o --project-id de un proyecto que pertenezca a un grupo.");
    } else if (scope !== "shared" && projectId === null) invalid("Indica --project-id o selecciona --scope shared explícitamente.");
  } else {
    if (scope !== "project" && scope !== "shared" && scope !== "ecosystem") invalid("scope debe ser project, shared o ecosystem.");
    if (scope === "shared" && projectId !== null) invalid("scope shared no acepta --project-id en operaciones sobre un recuerdo.");
    if (scope === "ecosystem" && projectId !== null) invalid("scope ecosystem no acepta --project-id en operaciones sobre un recuerdo.");
    if (scope === "ecosystem" && groupReference === undefined) invalid("scope ecosystem requiere --group.");
    if (scope === "project" && projectId === null) invalid("scope project requiere --project-id.");
  }
  let draft: Omit<Extract<SaveInput,{scope?:"project"}>,"projectId"|"scope"> | undefined;
  let query: string | undefined;
  let id: string | undefined;
  let limit = 10;
  if (command === "save") {
    const type = values.get("type") ?? "fact";
    if (!memoryTypes.includes(type as SaveInput["type"])) invalid("Tipo no válido. Consulta help.");
    const pinned = values.get("pinned");
    if (pinned !== undefined && pinned !== "true" && pinned !== "false") invalid("--pinned acepta true o false.");
    draft = { title: need("title"), content: need("content"), type: type as SaveInput["type"] };
    if (values.has("topic")) draft.topicKey = need("topic");
    if (values.has("request-key")) draft.requestKey = need("request-key");
    if (pinned !== undefined) draft.pinned = pinned === "true";
    if (values.has("expected-version")) {
      if (!draft.topicKey) invalid("--expected-version requiere --topic.");
      draft.expectedVersion = integer(need("expected-version"),"expected-version");
    }
    if(values.has("session-project-id")&&(scope==="project"||!values.has("session-id")))invalid("--session-project-id requiere scope shared o ecosystem y --session-id.");
    if(scope!=="project"&&values.has("session-id")&&!values.has("session-project-id"))invalid(`Un save ${scope} con sesión requiere --session-project-id.`);
  } else if (command === "search") {
    query = need("query");
    if (values.has("limit")) limit = integer(need("limit"),"limit",100);
  } else { id = need("id"); }

  const store = workspace.open(["search","get","history"].includes(command));
  try {
    // A group reference is an identifier or a name; resolving it never migrates a database.
    const groupId = groupReference === undefined ? null : store.resolveGroup(groupReference).id;
    let result: unknown;
    switch (command) {
      case "save": {
        const target: SaveInput = scope === "shared" ? { ...draft!, scope: "shared", projectId: null }
          : scope === "ecosystem" ? { ...draft!, scope: "ecosystem", projectId: null, groupId: groupId! }
          : { ...draft!, scope: "project", projectId: projectId! };
        result = values.has("session-id") ? store.saveWithSession(target,{sessionId:need("session-id"),...(values.has("session-project-id")?{projectId:projectIdentity(need("session-project-id"))}:{})}).memory : store.save(target);
        break;
      }
      case "search":
        if (scope === "ecosystem" && groupId !== null) {
          result = values.has("preview") ? store.searchPreviewsInGroup(groupId,query!,limit) : store.searchInGroup(groupId,query!,limit);
        } else {
          result = values.has("preview") ? store.searchPreviews(projectId,query!,limit,scope as SearchScope) : store.search(projectId,query!,limit,scope as SearchScope);
        }
        break;
      case "get":
        if (groupId !== null) result = values.has("version") ? store.getVersionInGroup(groupId,id!,integer(need("version"),"version")) : store.getInGroup(groupId,id!);
        else result = values.has("version") ? store.getVersion(projectId,id!,integer(need("version"),"version")) : store.get(projectId,id!);
        if (result === null) throw new MemoryError("NOT_FOUND","Recuerdo no encontrado en el alcance seleccionado.");
        break;
      case "history": result = groupId !== null ? store.historyInGroup(groupId,id!) : store.history(projectId,id!); break;
      case "archive": result = groupId !== null ? store.archiveInGroup(groupId,id!) : store.archive(projectId,id!); break;
      case "restore": result = groupId !== null ? store.restoreInGroup(groupId,id!) : store.restore(projectId,id!); break;
    }
    console.log(JSON.stringify(result,null,2));
  } finally { store.close(); }
}
