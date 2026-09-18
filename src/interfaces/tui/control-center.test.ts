import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import type { ReadStream, WriteStream } from "node:tty";
import type { ControlCenterMutation, ControlCenterSnapshot } from "../../modules/control-center";
import { MemoryError } from "../../shared/errors";
import { controlCenterTui } from "./control-center";

const baseSnapshot: ControlCenterSnapshot = {
  storage: {
    initialized:true,
    databasePath:"/safe/engram.db",
    capabilities:{schema:3, assistantIntegration:false, sessions:false, reinforcement:false},
    postgres:"not-configured",
  },
  projects:[],
  shared:{active:0, archived:0, lastUpdatedAt:null},
};

function ttyFixture() {
  const input = new PassThrough() as PassThrough & Partial<ReadStream>;
  const output = new PassThrough() as PassThrough & Partial<WriteStream>;
  const rawModes: boolean[] = [];
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = ((raw:boolean) => {
    rawModes.push(raw);
    input.isRaw = raw;
    return input as unknown as ReadStream;
  }) as ReadStream["setRawMode"];
  output.isTTY = true;
  output.columns = 80;
  output.rows = 24;
  let text = "";
  output.on("data", chunk => { text += chunk.toString(); });
  return {
    input:input as unknown as ReadStream,
    output:output as unknown as WriteStream,
    rawModes,
    text:() => text,
  };
}

function press(input: ReadStream, name:string, text = ""): void {
  input.emit("keypress", text, {name, ctrl:false, meta:false, shift:false, sequence:text});
}

function type(input: ReadStream, value:string): void {
  for (const character of value) press(input, character === " " ? "space" : character, character);
}

function openActions(input: ReadStream): void {
  for (let index = 0; index < 4; index += 1) press(input, "down");
  press(input, "return");
}

function confirm(input: ReadStream): void {
  type(input, "confirm");
  press(input, "return");
}

async function waitFor(predicate:()=>boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Bun.sleep(1);
  }
  throw new Error("condition not reached");
}

test("non-TTY rejects before configuration or snapshot reads", async () => {
  const input = new PassThrough() as unknown as ReadStream;
  const output = new PassThrough() as unknown as WriteStream;
  let reads = 0;
  await expect(controlCenterTui({input, output, readSnapshot:() => { reads += 1; return baseSnapshot; }}))
    .rejects.toMatchObject({code:"INTERACTIVE_REQUIRED"});
  expect(reads).toBe(0);
});

test("Ctrl+C and EOF restore raw mode, cursor, screen and listeners", async () => {
  for (const ending of ["cancel", "eof"] as const) {
    const fixture = ttyFixture();
    const initial = {
      keypress:fixture.input.listenerCount("keypress"),
      end:fixture.input.listenerCount("end"),
      error:fixture.input.listenerCount("error"),
      resize:fixture.output.listenerCount("resize"),
    };
    const run = controlCenterTui({...fixture, readSnapshot:() => baseSnapshot});
    const beforeResize = fixture.text().length;
    fixture.output.columns = 30;
    fixture.output.rows = 8;
    fixture.output.emit("resize");
    expect(fixture.text().length).toBeGreaterThan(beforeResize);
    if (ending === "cancel") press(fixture.input, "c", "\x03"), fixture.input.emit("keypress", "\x03", {name:"c", ctrl:true});
    else fixture.input.emit("end");
    expect(await run).toEqual({cancelled:true, openAssistants:false});
    expect(fixture.rawModes).toEqual([true, false]);
    expect(fixture.text()).toContain("\x1b[?25h");
    expect(fixture.text()).toContain("\x1b[?1049l");
    expect(fixture.input.listenerCount("keypress")).toBe(initial.keypress);
    expect(fixture.input.listenerCount("end")).toBe(initial.end);
    expect(fixture.input.listenerCount("error")).toBe(initial.error);
    expect(fixture.output.listenerCount("resize")).toBe(initial.resize);
  }
});

test("Escape discards a draft and invalid confirmation never executes", async () => {
  const fixture = ttyFixture();
  let executions = 0;
  const run = controlCenterTui({
    ...fixture,
    readSnapshot:() => baseSnapshot,
    executeMutation:async () => { executions += 1; return "unexpected"; },
  });
  openActions(fixture.input);
  press(fixture.input, "return");
  type(fixture.input, "draft");
  press(fixture.input, "escape");
  press(fixture.input, "down");
  press(fixture.input, "return");
  press(fixture.input, "return");
  press(fixture.input, "escape");
  fixture.input.emit("keypress", "\x03", {name:"c", ctrl:true});
  await run;
  expect(executions).toBe(0);
});

test("confirmed create executes once, refreshes and displays the safe result", async () => {
  const fixture = ttyFixture();
  let snapshot = baseSnapshot;
  const mutations: ControlCenterMutation[] = [];
  let reads = 0;
  const run = controlCenterTui({
    ...fixture,
    readSnapshot:() => { reads += 1; return snapshot; },
    executeMutation:async (_config, mutation) => {
      mutations.push(mutation);
      snapshot = {...baseSnapshot, projects:[{
        projectId:"11111111-1111-4111-8111-111111111111", name:"Demo",
        createdAt:"2026-09-17T00:00:00.000Z", updatedAt:"2026-09-17T00:00:00.000Z",
        bindings:[], memories:{active:0, archived:0, lastUpdatedAt:null},
      }]};
      return "Proyecto creado: Demo (11111111-1111-4111-8111-111111111111).";
    },
  });
  openActions(fixture.input);
  press(fixture.input, "return");
  type(fixture.input, "Demo");
  press(fixture.input, "return");
  confirm(fixture.input);
  await waitFor(() => fixture.text().includes("Proyecto creado: Demo"));
  expect(mutations).toEqual([{kind:"create-project", name:"Demo"}]);
  expect(reads).toBe(2);
  fixture.input.emit("keypress", "\x03", {name:"c", ctrl:true});
  await run;
});

test("real terminal bytes preserve mixed-case project names and directory input", async () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  for (const binding of [false, true]) {
    const fixture = ttyFixture();
    const mutations: ControlCenterMutation[] = [];
    const run = controlCenterTui({
      ...fixture,
      readSnapshot:() => ({...baseSnapshot, projects:[{
        projectId, name:"Existing", createdAt:"2026-09-17T00:00:00.000Z",
        updatedAt:"2026-09-17T00:00:00.000Z", bindings:[],
        memories:{active:0, archived:0, lastUpdatedAt:null},
      }]}),
      executeMutation:async (_config, mutation) => { mutations.push(mutation); return "Saved"; },
    });
    // Feed the actual readline decoder, whose key.name normalizes uppercase letters.
    fixture.input.emit("data", Buffer.from("\x1b[1;5B\x1b[1;3B\x1b[B\x1b[B\r"));
    if (binding) fixture.input.emit("data", Buffer.from("\x1b[B\x1b[B\r\r"));
    else fixture.input.emit("data", Buffer.from("\r"));
    fixture.input.emit("data", Buffer.from((binding ? "/Users/Example/MyProject" : "MyProject") + "\rCoNfIrM\r"));
    fixture.input.emit("data", Buffer.from("\x03"));
    expect(await run).toEqual({cancelled:true, openAssistants:false});
    expect(mutations).toEqual([binding
      ? {kind:"bind-directory", projectId, directory:"/Users/Example/MyProject"}
      : {kind:"create-project", name:"MyProject"}]);
    expect(fixture.input.isRaw).toBe(false);
  }
});

test("busy confirmation ignores duplicate Enter and capability result uses refreshed state", async () => {
  const fixture = ttyFixture();
  let resolveMutation!:(message:string)=>void;
  const pending = new Promise<string>(resolve => { resolveMutation = resolve; });
  let calls = 0;
  let enabled = false;
  const run = controlCenterTui({
    ...fixture,
    readSnapshot:() => enabled ? {
      ...baseSnapshot,
      storage:{...baseSnapshot.storage, capabilities:{schema:5, assistantIntegration:true, sessions:false, reinforcement:false}},
    } : baseSnapshot,
    executeMutation:async () => { calls += 1; const result = await pending; enabled = true; return result; },
  });
  openActions(fixture.input);
  press(fixture.input, "down");
  press(fixture.input, "return");
  confirm(fixture.input);
  press(fixture.input, "return");
  expect(calls).toBe(1);
  resolveMutation("Integración de asistentes habilitada: esquema 5.");
  await waitFor(() => fixture.text().includes("esquema 5."));
  fixture.input.emit("keypress", "\x03", {name:"c", ctrl:true});
  await run;
  expect(calls).toBe(1);
});

test("Ctrl+C and EOF settle and detach the terminal while a confirmed mutation remains pending", async () => {
  for (const ending of ["ctrl-c", "eof"] as const) {
    const fixture = ttyFixture();
    let resolveMutation!:(message:string)=>void;
    let released = false;
    const pending = new Promise<string>(resolve => {
      resolveMutation = message => { if (!released) { released = true; resolve(message); } };
    });
    let reads = 0;
    let calls = 0;
    const run = controlCenterTui({
      ...fixture,
      readSnapshot:() => { reads += 1; return baseSnapshot; },
      executeMutation:async () => { calls += 1; return pending; },
    });
    openActions(fixture.input);
    press(fixture.input, "down");
    press(fixture.input, "return");
    confirm(fixture.input);
    expect(calls).toBe(1);

    if (ending === "ctrl-c") fixture.input.emit("keypress", "\x03", {name:"c", ctrl:true});
    else fixture.input.emit("end");
    const early = await Promise.race([
      run.then(result => ({result})),
      Bun.sleep(20).then(() => null),
    ]);

    if (early === null) {
      resolveMutation("late result");
      await Bun.sleep(0);
      if (ending === "ctrl-c") fixture.input.emit("keypress", "\x03", {name:"c", ctrl:true});
      else fixture.input.emit("end");
      await run;
    }
    expect(early?.result).toEqual({cancelled:true, openAssistants:false});
    expect(fixture.input.isRaw).toBe(false);
    expect(fixture.rawModes).toEqual([true, false]);
    const closedOutputLength = fixture.text().length;
    resolveMutation("late result");
    await Bun.sleep(0);
    expect(reads).toBe(1);
    expect(fixture.text().length).toBe(closedOutputLength);
    expect(fixture.input.listenerCount("keypress")).toBe(0);
    expect(fixture.input.listenerCount("end")).toBe(0);
    expect(fixture.output.listenerCount("resize")).toBe(0);
  }
});

test("errors refresh only when safe and never render arbitrary thrown secrets", async () => {
  for (const error of [
    new MemoryError("DATABASE_BUSY", "La base está ocupada."),
    new Error("ARBITRARY_SECRET_TEXT"),
  ]) {
    const fixture = ttyFixture();
    let reads = 0;
    const run = controlCenterTui({
      ...fixture,
      readSnapshot:() => { reads += 1; if (reads > 1 && !(error instanceof MemoryError)) throw new Error("READ_SECRET"); return baseSnapshot; },
      executeMutation:async () => { throw error; },
    });
    openActions(fixture.input);
    press(fixture.input, "down");
    press(fixture.input, "return");
    confirm(fixture.input);
    await waitFor(() => fixture.text().includes(error instanceof MemoryError ? "DATABASE_BUSY" : "IO_ERROR"));
    expect(fixture.text()).not.toContain("ARBITRARY_SECRET_TEXT");
    expect(fixture.text()).not.toContain("READ_SECRET");
    fixture.input.emit("keypress", "\x03", {name:"c", ctrl:true});
    await run;
  }
});

test("assistant intent returns only after terminal restoration", async () => {
  const fixture = ttyFixture();
  const run = controlCenterTui({...fixture, readSnapshot:() => baseSnapshot});
  for (let index = 0; index < 5; index += 1) press(fixture.input, "down");
  press(fixture.input, "return");
  expect(await run).toEqual({cancelled:false, openAssistants:true});
  expect(fixture.input.isRaw).toBe(false);
  expect(fixture.text()).toEndWith("\x1b[?25h\x1b[?1049l");
});
