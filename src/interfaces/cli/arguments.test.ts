/** Comprueba `parseArguments`, `integer` y `nonnegative`: qué combinaciones de comando y opciones acepta o rechaza cada una. */
import { expect, test } from "bun:test";
import { integer, nonnegative, parseArguments } from "./arguments";

// Los valores de texto se recortan (trim), una bandera booleana no consume el siguiente argumento, y pedir una opción no dada con need() lanza INVALID_INPUT.
test("parser trims values, consumes boolean switches and requires command-specific values", () => {
  const parsed = parseArguments(["search", "--query", "  durable memory  ", "--preview", "--scope", "shared"]);
  expect(parsed.command).toBe("search");
  expect([...parsed.values]).toEqual([["query", "durable memory"], ["preview", "true"], ["scope", "shared"]]);
  expect(parsed.need("query")).toBe("durable memory");
  expect(() => parsed.need("project-id")).toThrow(expect.objectContaining({code:"INVALID_INPUT"}));
});

// reinforcement-enable no admite ninguna opción; solo existe como el comando exacto, sin argumentos.
test("parser accepts reinforcement enrollment only as an optionless explicit command", () => {
  expect(parseArguments(["reinforcement-enable"]).command).toBe("reinforcement-enable");
  expect(() => parseArguments(["reinforcement-enable", "--force"])).toThrow(expect.objectContaining({code:"INVALID_INPUT"}));
});

// intelligence-enable, igual que reinforcement-enable, tampoco admite ninguna opción.
test("parser accepts intelligence enrollment only as an optionless explicit command", () => {
  expect(parseArguments(["intelligence-enable"]).command).toBe("intelligence-enable");
  expect(() => parseArguments(["intelligence-enable", "--force"])).toThrow(expect.objectContaining({code:"INVALID_INPUT"}));
});

// update acepta --json de forma opcional, y ninguna otra bandera.
test("parser accepts update with optional JSON output and rejects unknown flags", () => {
  expect(parseArguments(["update"]).command).toBe("update");
  expect(parseArguments(["update", "--json"]).values.get("json")).toBe("true");
  expect(() => parseArguments(["update", "--force"])).toThrow(expect.objectContaining({code:"INVALID_INPUT"}));
});

// memory-protocol exige --json siempre, y su --protocol-version (cuando se da) solo puede ser un formato reconocido.
test("parser requires JSON for the public memory protocol", () => {
  expect(parseArguments(["memory-protocol", "--json"]).values.get("json")).toBe("true");
  expect(() => parseArguments(["memory-protocol"])).toThrow(expect.objectContaining({code:"INVALID_INPUT"}));
  expect(() => parseArguments(["memory-protocol", "--json", "--format", "text"])).toThrow(expect.objectContaining({code:"INVALID_INPUT"}));
});

// --postgres-url de init solo se acepta junto con --json (uso no interactivo); ningún otro comando admite esa opción.
test("parser accepts an optional PostgreSQL URL only for noninteractive initialization", () => {
  expect(parseArguments(["init", "--json"]).values.get("json")).toBe("true");
  expect(parseArguments(["init", "--json", "--postgres-url", "postgresql://user:secret@host/db"]).values.get("postgres-url")).toBe("postgresql://user:secret@host/db");
  expect(() => parseArguments(["init", "--postgres-url", "postgresql://user:secret@host/db"])).toThrow(expect.objectContaining({code:"INVALID_INPUT"}));
  expect(() => parseArguments(["project-list", "--json"])).toThrow(expect.objectContaining({code:"INVALID_INPUT"}));
});

// "cloud on|off|status" (dos palabras) se traduce a "cloud-on"/"cloud-off"/"cloud-status" (D9); cada uno conserva sus propias opciones y el resto de los argumentos.
test("parser translates the two-word cloud command into its hyphenated form", () => {
  expect(parseArguments(["cloud", "on", "--postgres-url", "postgresql://user:secret@host/db"])).toMatchObject({ command: "cloud-on" });
  expect(parseArguments(["cloud", "on", "--postgres-url", "postgresql://user:secret@host/db"]).values.get("postgres-url")).toBe("postgresql://user:secret@host/db");
  expect(parseArguments(["cloud", "off"]).command).toBe("cloud-off");
  expect(parseArguments(["cloud", "status"]).command).toBe("cloud-status");
  expect(parseArguments(["cloud", "status", "--json"]).values.get("json")).toBe("true");
});

// "cloud" sin subcomando, o con uno que no es on/off/status, es un comando desconocido; cloud off y cloud on sin --postgres-url no admiten opciones ajenas.
test("parser rejects an unknown cloud subcommand and options that do not belong to it", () => {
  expect(() => parseArguments(["cloud"])).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  expect(() => parseArguments(["cloud", "sideways"])).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  expect(() => parseArguments(["cloud", "off", "--postgres-url", "postgresql://user:secret@host/db"])).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  expect(() => parseArguments(["cloud", "on", "--json"])).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
});

// Comandos retirados de versiones anteriores (asistente propio, TUI local) ya no existen: cualquier intento de usarlos es un comando desconocido.
test("parser no longer exposes assistant ownership or a local TUI", () => {
  for (const command of ["tui", "assistant-list", "memory-hook", "integration-enable"]) {
    expect(() => parseArguments([command])).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  }
});

// uninstall no exige --confirm para analizarse (la confirmación la pide commands.ts más adelante), pero si se repite la opción, falla.
test("parser requires one explicit uninstall confirmation", () => {
  expect(parseArguments(["uninstall", "--confirm", "REMOVE FORGE614-ENGRAM"]).need("confirm")).toBe("REMOVE FORGE614-ENGRAM");
  expect(() => parseArguments(["uninstall"])).not.toThrow();
  expect(() => parseArguments(["uninstall", "--confirm", "x", "--confirm", "x"])).toThrow(expect.objectContaining({code:"INVALID_INPUT"}));
});

// Comando inexistente, opción no permitida para ese comando, opción repetida, valor vacío, valor con byte nulo, un valor booleano con texto en vez de bandera, y un argumento que no empieza con "--": todos son entradas mal formadas.
test.each([
  ["unknown"], ["save", "--query", "x"], ["search", "--query", "x", "--query", "y"],
  ["search", "--query"], ["search", "--query", "  "], ["search", "--query", "x\0y"],
  ["search", "--preview", "true"], ["search", "query", "x"],
].map(args=>({args})))("parser rejects malformed command %j", ({args}) => {
  expect(() => parseArguments(args)).toThrow(expect.objectContaining({code:"INVALID_INPUT"}));
});

// integer acepta de 1 al máximo dado (inclusive); nonnegative además acepta 0; ambos rechazan fracciones, signos, y enteros fuera del rango seguro.
test("numeric options enforce inclusive bounds and reject fractional, signed and unsafe inputs", () => {
  expect(integer("1", "limit", 100)).toBe(1);
  expect(integer("100", "limit", 100)).toBe(100);
  expect(nonnegative("0", "before", 20)).toBe(0);
  expect(nonnegative("20", "before", 20)).toBe(20);
  for (const value of ["0", "101", "1.5", "-1", "+1", "1e2", "9007199254740992"]) {
    expect(() => integer(value, "limit", 100)).toThrow();
  }
  for (const value of ["21", "-1", "1.5", "9007199254740992"]) expect(() => nonnegative(value, "before", 20)).toThrow();
});
