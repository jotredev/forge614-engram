/** Utilidades de prueba para verificar permisos POSIX cuando el sistema los expone. */
import { expect } from "bun:test";
import { statSync } from "node:fs";

/**
 * Comprueba los permisos POSIX esperados en macOS y Linux; Windows no expone los bits de modo
 * equivalentes, así que omite solo esa comparación para conservar la intención de las pruebas.
 */
export function expectPosixMode(path: string, expected: number): void {
  if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(expected);
}
