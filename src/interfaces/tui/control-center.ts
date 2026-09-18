import { emitKeypressEvents, type Key } from "node:readline";
import type { ReadStream, WriteStream } from "node:tty";
import {
  executeControlCenterMutation,
  readControlCenter,
  WorkspaceConfig,
} from "../../app";
import type { ControlCenterMutation, ControlCenterSnapshot } from "../../modules/control-center";
import { MemoryError } from "../../shared/errors";
import { renderControlCenterScreen } from "./control-center-render";
import { ControlCenterSession } from "./control-center-state";

export type ControlCenterTuiResult = {cancelled:boolean; openAssistants:boolean};

export interface ControlCenterTuiOptions {
  config?: WorkspaceConfig;
  input?: ReadStream;
  output?: WriteStream;
  readSnapshot?: (config:WorkspaceConfig) => ControlCenterSnapshot;
  executeMutation?: (config:WorkspaceConfig, mutation:ControlCenterMutation) => Promise<string>;
}

function safeError(error:unknown): string {
  return error instanceof MemoryError
    ? `${error.code}: ${error.message}`
    : "IO_ERROR: No se pudo completar la operación. Revisa permisos y almacenamiento sin compartir datos privados.";
}

/** Owns one control-center terminal session. Assistant composition happens after cleanup in the CLI. */
export async function controlCenterTui(options:ControlCenterTuiOptions = {}): Promise<ControlCenterTuiResult> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new MemoryError(
      "INTERACTIVE_REQUIRED",
      "tui necesita una terminal interactiva. Ejecuta forge614-engram tui en tu terminal.",
    );
  }

  const config = options.config ?? new WorkspaceConfig();
  const readSnapshot = options.readSnapshot ?? readControlCenter;
  const executeMutation = options.executeMutation ?? executeControlCenterMutation;
  const session = new ControlCenterSession(readSnapshot(config));
  const wasRaw = !!input.isRaw;
  const wasFlowing = input.readableFlowing === true;
  let busy = false;
  let settled = false;
  let resolveDone!:(result:ControlCenterTuiResult)=>void;
  const done = new Promise<ControlCenterTuiResult>(resolve => { resolveDone = resolve; });
  const draw = () => {
    if (!settled) {
      output.write("\x1b[H\x1b[2J" + renderControlCenterScreen(session.state, output.columns || 80, output.rows || 24));
    }
  };
  const finish = (result:ControlCenterTuiResult) => {
    if (settled) return;
    settled = true;
    if (result.cancelled) session.key("cancel");
    resolveDone(result);
  };
  const cancel = () => { finish({cancelled:true, openAssistants:false}); };
  const runMutation = async (mutation:ControlCenterMutation) => {
    busy = true;
    draw();
    try {
      const message = await executeMutation(config, mutation);
      if (settled) return;
      const snapshot = readSnapshot(config);
      if (settled) return;
      session.refresh(snapshot);
      session.setResult(message);
    } catch (error) {
      if (settled) return;
      try {
        const snapshot = readSnapshot(config);
        if (settled) return;
        session.refresh(snapshot);
      } catch { /* retain the last safe snapshot */ }
      if (settled) return;
      session.setResult(safeError(error));
    } finally {
      busy = false;
      draw();
    }
  };
  const press = (text:string | undefined, key:Key) => {
    if (settled) return;
    if (key.ctrl && key.name === "c") { cancel(); return; }
    if (busy) return;
    const name = key.name === "return" ? "enter" : key.name === "space" ? "space" : key.name;
    const printable = !key.ctrl && !key.meta && typeof text === "string" && Array.from(text).length === 1 && !/[\x00-\x1f\x7f-\x9f]/.test(text);
    session.key(printable ? text : name ?? text ?? "");
    const intent = session.consumeConfirmation();
    if (intent?.kind === "open-assistants") {
      finish({cancelled:false, openAssistants:true});
      return;
    }
    if (intent) void runMutation(intent);
    else if (session.state.done) finish({cancelled:session.state.cancelled, openAssistants:false});
    else draw();
  };

  try {
    emitKeypressEvents(input);
    input.setRawMode(true);
    output.write("\x1b[?1049h\x1b[?25l");
    input.on("keypress", press);
    input.on("end", cancel);
    input.on("error", cancel);
    output.on("resize", draw);
    process.on("SIGINT", cancel);
    process.on("SIGTERM", cancel);
    input.resume();
    draw();
    return await done;
  } finally {
    settled = true;
    input.off("keypress", press);
    input.off("end", cancel);
    input.off("error", cancel);
    output.off("resize", draw);
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    input.setRawMode(wasRaw);
    if (!wasFlowing) input.pause();
    output.write("\x1b[?25h\x1b[?1049l");
  }
}
