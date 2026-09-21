import { MemoryWorkspace, syncWorkspace, bindProjectContext, startProjectSession, uninstallEngram, updateEngram, applyMemoryInitialization, previewMemoryInitialization, inspectMemoryInitialization } from "../../app";
import type { EngramUpdateResult } from "../../app";
import { MemoryError } from "../../shared/errors";
import { memoryTypes, type SaveInput, type SearchScope } from "../../modules/memory";
import { memoryProtocol } from "../../modules/memory-protocol";
import { projectIdentity } from "../../modules/projects";
import { initTerminal } from "../terminal/setup";
import { watchSync } from "../terminal/sync-watch";
import { startMcp } from "../mcp/server";
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
  if (command === "memory-protocol") { console.log(JSON.stringify(memoryProtocol(), null, 2)); return; }
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
  if (command === "mcp") { await startMcp(); return; }
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
          try { store.enableProjectBindings(); }
          finally { store.close(); }
          result = inspectMemoryInitialization();
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
    const store=workspace.open();try{console.log(JSON.stringify(startProjectSession(store,need("directory"),need("session-id")),null,2));}finally{store.close();}return;
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
    const scope=values.get("scope")??"project";if(scope!=="project"&&scope!=="shared")invalid("scope debe ser project o shared.");
    if(scope==="shared"&&values.has("project-id"))invalid("scope shared no acepta --project-id.");
    const projectId=scope==="shared"?null:projectIdentity(need("project-id"));
    const store=workspace.open(true);try{console.log(JSON.stringify(store.context(projectId,{compact:values.has("compact"),...(values.has("max-bytes")?{maxBytes:integer(need("max-bytes"),"max-bytes",65536)}:{})}),null,2));}finally{store.close();}return;
  }
  // Complete argument validation before reading config or opening any database.
  const scope = values.get("scope") ?? (command === "search" ? "all" : "project");
  const projectId = values.has("project-id") ? projectIdentity(need("project-id")) : null;
  if (command === "search") {
    if (!["all","project","shared"].includes(scope)) invalid("scope debe ser all, project o shared.");
    if (scope !== "shared" && projectId === null) invalid("Indica --project-id o selecciona --scope shared explícitamente.");
  } else {
    if (scope !== "project" && scope !== "shared") invalid("scope debe ser project o shared.");
    if (scope === "shared" && projectId !== null) invalid("scope shared no acepta --project-id en operaciones sobre un recuerdo.");
    if (scope === "project" && projectId === null) invalid("scope project requiere --project-id.");
  }
  let saveInput: SaveInput | undefined;
  let query: string | undefined;
  let id: string | undefined;
  let limit = 10;
  if (command === "save") {
    const type = values.get("type") ?? "fact";
    if (!memoryTypes.includes(type as SaveInput["type"])) invalid("Tipo no válido. Consulta help.");
    const pinned = values.get("pinned");
    if (pinned !== undefined && pinned !== "true" && pinned !== "false") invalid("--pinned acepta true o false.");
    const target = scope === "shared"
      ? { scope: "shared" as const, projectId: null }
      : { scope: "project" as const, projectId: projectId! };
    saveInput = { ...target, title: need("title"), content: need("content"), type: type as SaveInput["type"] };
    if (values.has("topic")) saveInput.topicKey = need("topic");
    if (values.has("request-key")) saveInput.requestKey = need("request-key");
    if (pinned !== undefined) saveInput.pinned = pinned === "true";
    if (values.has("expected-version")) {
      if (!saveInput.topicKey) invalid("--expected-version requiere --topic.");
      saveInput.expectedVersion = integer(need("expected-version"),"expected-version");
    }
    if(values.has("session-project-id")&&(scope!=="shared"||!values.has("session-id")))invalid("--session-project-id requiere scope shared y --session-id.");
    if(scope==="shared"&&values.has("session-id")&&!values.has("session-project-id"))invalid("Un save shared con sesión requiere --session-project-id.");
  } else if (command === "search") {
    query = need("query");
    if (values.has("limit")) limit = integer(need("limit"),"limit",100);
  } else { id = need("id"); }

  const store = workspace.open(["search","get","history"].includes(command));
  try {
    let result: unknown;
    switch (command) {
      case "save": result = values.has("session-id") ? store.saveWithSession(saveInput!,{sessionId:need("session-id"),...(values.has("session-project-id")?{projectId:projectIdentity(need("session-project-id"))}:{})}).memory : store.save(saveInput!); break;
      case "search": result = values.has("preview") ? store.searchPreviews(projectId,query!,limit,scope as SearchScope) : store.search(projectId,query!,limit,scope as SearchScope); break;
      case "get":
        result = values.has("version") ? store.getVersion(projectId,id!,integer(need("version"),"version")) : store.get(projectId,id!);
        if (result === null) throw new MemoryError("NOT_FOUND","Recuerdo no encontrado en el alcance seleccionado.");
        break;
      case "history": result = store.history(projectId,id!); break;
      case "archive": result = store.archive(projectId,id!); break;
      case "restore": result = store.restore(projectId,id!); break;
    }
    console.log(JSON.stringify(result,null,2));
  } finally { store.close(); }
}
