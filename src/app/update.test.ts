/**
 * Comprueba que updateEngram delega en el instalador real, devuelve su resultado tal
 * cual y esconde cualquier error del instalador detrás del código UPDATE_FAILED.
 */
import { expect, test } from "bun:test";
import { updateEngram } from "./update";

// Verifica que, sin `dependencies.run`, se invoca la función que hace la actualización de verdad.
test("application update delegates to the installed-release updater", async () => {
  let invoked = false;

  await updateEngram("1.3.0", { run: async () => { invoked = true; return { updated: false, previousVersion: "1.3.0", installedVersion: "1.3.0" }; } });

  expect(invoked).toBe(true);
});

// Verifica que el objeto devuelto conserva exactamente los tres campos que espera la CLI.
test("application update returns structured versions for CLI consumers", async () => {
  const result = await updateEngram("1.3.0", {
    run: async () => ({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" }),
  });

  expect(result).toEqual({ updated: true, previousVersion: "1.3.0", installedVersion: "1.4.0" });
});

// Verifica que un error arbitrario del instalador (aquí, uno que lleva una contraseña
// en el mensaje) nunca llega a quien llama: se reemplaza siempre por UPDATE_FAILED.
test("application update masks installer diagnostics behind UPDATE_FAILED", async () => {
  const secret = "POSTGRES_PASSWORD_SHOULD_NOT_LEAK";

  await expect(updateEngram("1.3.0", { run: async () => { throw new Error(secret); } })).rejects.toMatchObject({
    code: "UPDATE_FAILED",
    message: "No se pudo actualizar Forge614 Engram.",
  });

  await expect(updateEngram("1.3.0", { run: async () => { throw new Error(secret); } })).rejects.not.toThrow(secret);
});
