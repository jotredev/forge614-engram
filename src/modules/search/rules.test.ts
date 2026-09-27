/** Comprueba la separación en términos y el escape de comillas de searchTerms, y los límites válidos de validateSearchLimit. */
import { expect, test } from "bun:test";
import { searchTerms, validateSearchLimit } from "./rules";

// Los espacios (incluidos tabulaciones y saltos de línea) separan los términos; una comilla dentro de
// un término se escapa duplicándola, sin tratarla como sintaxis de FTS5; un término de menos de tres
// letras (incluido un emoji, que cuenta como un solo carácter) activa el modo literal.
test("search terms trim whitespace and escape quoted literals without treating them as FTS syntax", () => {
  expect(searchTerms('alpha b"')).toEqual({terms:["alpha",'b"'],literal:true,match:'"alpha" AND "b"""'});
  expect(searchTerms("  alpha\t beta\n")).toEqual({terms:["alpha","beta"],literal:false,match:'"alpha" AND "beta"'});
  expect(searchTerms("😀😀").literal).toBe(true);
  for (const value of ["", " \t", "a\0b"]) expect(() => searchTerms(value)).toThrow(expect.objectContaining({code:"INVALID_INPUT"}));
});
// Los límites 1 y 100 son válidos (inclusive); cero, más de 100, decimales, NaN e Infinity se rechazan.
test("search limit permits inclusive bounds and rejects nonintegers and out of range values", () => {
  expect(() => validateSearchLimit(1)).not.toThrow();
  expect(() => validateSearchLimit(100)).not.toThrow();
  for (const value of [0,101,1.5,NaN,Infinity]) expect(() => validateSearchLimit(value)).toThrow(expect.objectContaining({code:"INVALID_INPUT"}));
});
