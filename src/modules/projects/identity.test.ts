/** Comprueba que solo un UUID v4 exacto de proyecto se acepte, y que nombres, otras versiones de UUID y variantes con espacio o mayúsculas se rechacen. */
import { expect, test } from "bun:test";
import { projectIdentity } from "./identity";

// Un UUID v4 válido pasa tal cual; nulo, un número, un nombre, mayúsculas, versión distinta (4→1),
// variante distinta (8→7) y un espacio inicial deben rechazarse todos con el mismo código de error.
test("project identity accepts a UUID v4 and rejects names, other versions and variants", () => {
  const id = "12345678-1234-4234-8234-123456789abc";
  expect(projectIdentity(id)).toBe(id);
  for (const value of [null, 42, "Project", id.toUpperCase(), id.replace("4234", "1234"), id.replace("8234", "7234"), ` ${id}`]) {
    expect(() => projectIdentity(value)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  }
});
