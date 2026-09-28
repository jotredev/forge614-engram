/**
 * Despachador central del CLI (interfaz de línea de comandos): a partir del comando y las opciones ya validadas
 * por `parseArguments`, abre el espacio de trabajo (workspace) que corresponda y llama a la operación de `app`
 * adecuada, imprimiendo el resultado como JSON. `main.ts` llama a `dispatch` con el resultado de `parseArguments`.
 */
import { MemoryWorkspace, syncWorkspace, bindProjectContext, resolveProjectContext, startProjectSessionWithNotices, uninstallEngram, updateEngram, applyMemoryInitialization, previewMemoryInitialization, inspectMemoryInitialization, readProjectContext, readStartupBlock, readStartupContext, cloudSettings, waitForCloud, runCloudOn, runCloudOff, runCloudStatus, runCloudSync } from "../../app";
import type { EngramUpdateResult } from "../../app";
import { MemoryError } from "../../shared/errors";
import { memoryTypes, type SaveInput, type SearchScope } from "../../modules/memory";
import { memoryProtocol } from "../../modules/memory-protocol";
import { projectIdentity } from "../../modules/projects";
import { sessionNotice } from "../../modules/sessions";
import { readCloudPostgresUrl } from "../terminal/cloud-input";
import { initTerminal } from "../terminal/setup";
import { watchSync } from "../terminal/sync-watch";
import { invalid, integer, nonnegative, type ParsedCommand } from "./arguments";

// Texto exacto del aviso de obsolescencia de D10 (sync --upgrade-format, formatos 1-3): se retira en la fecha dada, sin cambiar su código.
const SYNC_UPGRADE_FORMAT_DEPRECATED = { code: "SYNC_UPGRADE_FORMAT_DEPRECATED", error: "sync --upgrade-format es obsoleto; se retira el 2027-03-31." };

/** Imprime en líneas legibles en español las cifras de `cloud status` cuando no se pidió `--json` (mismo idioma que sus vecinos, D16). */
function printCloudStatus(status: ReturnType<typeof runCloudStatus>): void {
  console.log(`Nube: ${status.enabled ? "activada" : "desactivada"}`);
  console.log(`Id de instalación: ${status.installationId ?? "(ninguno)"}`);
  console.log(`Último cambio aplicado: ${status.lastAppliedId ?? "(ninguno)"}`);
  console.log(`Pendientes en la cola: ${status.pending}`);
  console.log(`Pendiente más viejo: ${status.oldestPendingAt ?? "(ninguno)"}`);
}

/** Convierte el resultado de `update` en el JSON exacto que imprime `runUpdateCommand` cuando se pide `--json`. */
export function updateResultJson(result: EngramUpdateResult): string {
  return JSON.stringify(result);
}

/** Ejecuta el comando `update`: descarga y aplica la actualización, e imprime el resultado solo si se pidió `--json` (el modo interactivo ya muestra su propio progreso dentro de `updateEngram`). */
export async function runUpdateCommand(
  json: boolean,
  currentVersion: string,
  update: () => Promise<EngramUpdateResult> = () => updateEngram(currentVersion, { quiet: json }),
  print: (value: string) => void = console.log,
): Promise<void> {
  const result = await update();
  if (json) print(updateResultJson(result));
}

/** Ejecuta el comando ya analizado: resuelve los comandos que no necesitan abrir la base primero, luego los que sí, y termina con el grupo save/search/get/history/archive/restore que comparte la validación de scope. */
export async function dispatch({command,values,need}:ParsedCommand, currentVersion = "0.0.0"):Promise<void> {
  if (command === "init" && !values.has("json")) { await initTerminal(); return; }
  if (command === "memory-protocol") {
    const requested = values.get("protocol-version");
    console.log(JSON.stringify(memoryProtocol(requested === "4" ? 4 : requested === "3" ? 3 : requested === "2" ? 2 : 1), null, 2));
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
  if (command === "cloud-on") {
    const url = values.get("postgres-url") ?? await readCloudPostgresUrl();
    console.log(JSON.stringify(await runCloudOn(url)));
    return;
  }
  if (command === "cloud-off") { console.log(JSON.stringify(await runCloudOff())); return; }
  if (command === "cloud-status") {
    const status = runCloudStatus();
    if (values.has("json")) console.log(JSON.stringify(status)); else printCloudStatus(status);
    return;
  }
  if (command === "sync") {
    // --upgrade-format es la ruta obsoleta (D10): siempre el mecanismo local de formatos 1-3, con nube o sin ella.
    if (values.has("upgrade-format")) {
      console.error(JSON.stringify(SYNC_UPGRADE_FORMAT_DEPRECATED));
      console.log(JSON.stringify(await syncWorkspace(undefined,{upgradeFormat:true}),null,2));
      return;
    }
    // Con `cloud on` ya hecho (installationId presente), sync usa el ciclo nuevo; si no, sigue igual que hoy (D10).
    console.log(JSON.stringify(cloudSettings() ? await runCloudSync() : await syncWorkspace()));
    return;
  }
  if(command==="sync-watch"&&values.has("upgrade-format"))invalid("sync-watch no acepta --upgrade-format.");
  if (command === "sync-watch") {await watchSync(values.has("interval")?integer(need("interval"),"interval",3600):30);return;}
  // Cargado de forma perezosa (lazy): el SDK de MCP (y zod, con su barril de 64 archivos de locale) no
  // tiene por qué analizarse (parse) para ningún comando que no sea "mcp" -- ver la revisión de forge614-ai
  // de la investigación del bloqueo del CLI en v1.5.3, experimento 4 (un hijo bloqueado se sorprendió a
  // mitad de cargar un archivo de locale de zod para un comando que nunca usa MCP).
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
  if(command==="intelligence-enable"){
    workspace.init();const store=workspace.open();
    const result=(()=>{try{return store.enableIntelligence();}finally{store.close();}})();
    console.log(JSON.stringify({enabled:true,schema:11,migrated:result.migrated,backup:result.backup},null,2));return;
  }
  if (command === "project-bind") {
    const store = workspace.open();
    try { console.log(JSON.stringify(bindProjectContext(store,need("directory"),projectIdentity(need("project-id"))),null,2)); }
    finally { store.close(); }
    return;
  }
  if (command.startsWith("group-")) {
    let result: Record<string, unknown>;
    // Los seis subcomandos de grupo comparten el mismo sobre de salida (schemaVersion: 1); "default" cubre group-rename, el único sin `case` propio.
    switch (command) {
      case "group-create": {
        const created = workspace.createGroupWithNotices(need("name"));
        result = { group: created.group, ...(created.notices.length ? { notices: created.notices } : {}) }; break;
      }
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
      case "group-source-set": result = { source: workspace.setGroupSource(need("group"), projectIdentity(need("project-id"))) }; break;
      default: {
        const renamed = workspace.renameGroup(need("group"), need("name"));
        result = { group: renamed.group, identityFilesUpdated: renamed.identityFiles.updated };
      }
    }
    console.log(JSON.stringify({ schemaVersion: 1, ...result }, null, 2)); return;
  }
  if (command === "memory-move") {
    // memory-move solo sube de project o shared hacia ecosystem (nunca al revés ni entre otros pares); to-scope existe para que el comando lo diga explícitamente.
    const from = values.get("scope") ?? "project";
    if (from !== "project" && from !== "shared") invalid("scope debe ser project o shared (el origen del recuerdo).");
    if (need("to-scope") !== "ecosystem") invalid("to-scope solo acepta ecosystem.");
    if (from === "shared" && values.has("project-id")) invalid("scope shared no acepta --project-id.");
    if (from === "project" && !values.has("project-id")) invalid("Un recuerdo de proyecto requiere --project-id.");
    const moved = workspace.moveMemory(need("id"), from === "shared" ? null : projectIdentity(need("project-id")), need("group"));
    console.log(JSON.stringify({ schemaVersion: 1, ...moved }, null, 2)); return;
  }
  if (command === "memory-demote") {
    const demoted = workspace.demoteMemory(need("id"), projectIdentity(need("project-id")));
    console.log(JSON.stringify({ schemaVersion: 1, ...demoted }, null, 2)); return;
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
            // Vincular una carpeta es explícito y no interactivo: registra el proyecto (por su archivo de
            // identidad cuando el repositorio ya trae uno) y escribe .forge614/project.json en silencio.
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
    const store=workspace.open();try{const started=startProjectSessionWithNotices(store,need("directory"),need("session-id"));const notice=sessionNotice(started.previous,started.parallel,store.takeCloudNotices());console.log(JSON.stringify({...started.session,...(started.previous?{previous:started.previous}:{}),...(started.parallel?{parallel:started.parallel}:{}),...(started.notices.length?{notices:started.notices}:{}),...(notice?{sessionNotice:notice}:{})},null,2));}finally{store.close();}return;
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
    const read=values.get("format")==="2"?readStartupBlock:readStartupContext;
    // Primero de solo lectura: el caso común no escribe nada en la base, y una base intacta conserva su huella
    // exacta en disco. Solo cuando el flujo de identidad debe registrar algo (un clon, un grupo), o cuando hay
    // nube configurada (D8: la espera de arranque necesita aplicar lo bajado), se repite en modo escritura;
    // ambos flujos son idempotentes, así que repetirlo es seguro.
    const readonlyStore=workspace.open(true);
    let needsCloudWait=false;
    try{
      needsCloudWait=readonlyStore.cloudEnabled()&&cloudSettings()!==null;
      if(!needsCloudWait){console.log(JSON.stringify(read(readonlyStore,directory),null,2));return;}
    }
    catch(error){if((error as {code?:unknown})?.code!=="SQLITE_READONLY")throw error;}
    finally{readonlyStore.close();}
    const store=workspace.open();
    try{if(needsCloudWait)await waitForCloud(store);console.log(JSON.stringify(read(store,directory),null,2));}
    finally{store.close();}
    // Nota de laboratorio (D8): waitForCloud ya vuelve dentro de su propio tope, pero un intento de conexión
    // que ni siquiera terminó de conectarse (Neon, o aquí, un servidor mudo) deja un zócalo (socket) abierto
    // que Bun no puede cancelar por fuera (comprobado aparte: ni abortar la señal ni cerrar el cliente
    // interrumpen un handshake ya en curso). Sin forzar la salida, ese zócalo mantendría vivo el proceso
    // hasta su propio tiempo de espera de conexión (`connectionTimeout`, 5 s), incumpliendo "el proceso de
    // la CLI debe terminar enseguida después de imprimir". Se vacían stdout/stderr antes de salir para no
    // truncar el bloque ya impreso.
    if(needsCloudWait){
      await new Promise(resolve=>process.stdout.write("",resolve));
      await new Promise(resolve=>process.stderr.write("",resolve));
      process.exit(0);
    }
    return;
  }
  // Se completa la validación de argumentos antes de leer la configuración o abrir ninguna base de datos.
  const scope = values.get("scope") ?? (command === "search" ? "all" : "project");
  const projectId = values.has("project-id") ? projectIdentity(need("project-id")) : null;
  const groupReference = values.get("group");
  if (groupReference !== undefined && scope !== "ecosystem") invalid("--group solo se acepta con --scope ecosystem.");
  if (command === "search") {
    // search es más flexible que el resto: acepta scope all y, en ecosystem, puede resolver el grupo a partir de --project-id sin pedir --group.
    if (!["all","project","shared","ecosystem"].includes(scope)) invalid("scope debe ser all, project, shared o ecosystem.");
    if (scope === "ecosystem") {
      if (groupReference === undefined && projectId === null) invalid("scope ecosystem requiere --group, o --project-id de un proyecto que pertenezca a un grupo.");
    } else if (scope !== "shared" && projectId === null) invalid("Indica --project-id o selecciona --scope shared explícitamente.");
  } else {
    // save, get, history, archive y restore operan sobre un solo recuerdo: cada scope exige exactamente el identificador que le corresponde (--project-id para project, --group para ecosystem, ninguno para shared).
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
    if (values.has("affects")) draft.affects = need("affects").split(",");
    if (pinned !== undefined) draft.pinned = pinned === "true";
    if (values.has("expected-version")) {
      if (!draft.topicKey) invalid("--expected-version requiere --topic.");
      draft.expectedVersion = integer(need("expected-version"),"expected-version");
    }
    // shared y ecosystem no tienen projectId propio para deducir la sesión; por eso, si llevan --session-id, deben dar también --session-project-id (y viceversa).
    if(values.has("session-project-id")&&(scope==="project"||!values.has("session-id")))invalid("--session-project-id requiere scope shared o ecosystem y --session-id.");
    if(scope!=="project"&&values.has("session-id")&&!values.has("session-project-id"))invalid(`Un save ${scope} con sesión requiere --session-project-id.`);
  } else if (command === "search") {
    query = need("query");
    if (values.has("limit")) limit = integer(need("limit"),"limit",100);
  } else { id = need("id"); }

  const store = workspace.open(["search","get","history"].includes(command));
  try {
    // Una referencia de grupo es un identificador o un nombre; resolverla nunca migra una base de datos.
    const groupId = groupReference === undefined ? null : store.resolveGroup(groupReference).id;
    let result: unknown;
    switch (command) {
      case "save": {
        // El destino final se arma según el scope ya validado arriba; con --session-id, se guarda a través de saveWithSession para que quede unido a esa conversación.
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
