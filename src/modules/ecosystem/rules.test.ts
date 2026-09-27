/** Comprueba la validación de nombres de grupo, la validación de identidades UUID y el cálculo determinista del identificador declarado por nombre. */
import { expect, test } from "bun:test";
import { FORGE614_GROUP_ID, FORGE614_GROUP_NAME, declaredGroupId, groupIdentity, groupName, uuidV4 } from "./index";

// Solo minúsculas, dígitos y guiones simples internos (sin guion al inicio/final ni dobles) son nombres válidos;
// mayúsculas, espacios, guion bajo, ñ, largo excesivo, byte nulo y valores que no son cadena deben rechazarse.
test("group names accept only the stable lowercase pattern", () => {
  for (const good of ["forge614", "mi-tienda", "a", "a1-b2-c3", "x".repeat(64)]) expect(groupName(good)).toBe(good);
  for (const bad of ["", " ", "Forge614", "a b", "a_b", "-a", "a-", "a--b", "ñu", "x".repeat(65), "a\0b", 7, null, undefined]) {
    expect(() => groupName(bad)).toThrow(expect.objectContaining({ code: "GROUP_NAME_INVALID" }));
  }
});

// groupIdentity y uuidV4 deben aceptar cualquier UUID v4 bien formado (incluida la identidad fija de
// forge614) y rechazar nombres, cadenas vacías, UUID de otra versión y valores que no son cadena.
test("group and project identities are UUID v4 values", () => {
  expect(groupIdentity(FORGE614_GROUP_ID)).toBe(FORGE614_GROUP_ID);
  expect(uuidV4(crypto.randomUUID())).toBeTruthy();
  for (const bad of ["forge614", "", "6f0e1c1a-0000-1000-8000-000000000001", 5, null]) {
    expect(() => groupIdentity(bad)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  }
});

// El nombre "forge614" siempre resuelve a la identidad fija FORGE614_GROUP_ID; cualquier otro nombre
// produce el mismo UUID cada vez que se calcula, pero un UUID distinto entre nombres distintos.
test("the group declared by a node file has a stable identity on every machine", () => {
  expect(FORGE614_GROUP_NAME).toBe("forge614");
  expect(declaredGroupId("forge614")).toBe(FORGE614_GROUP_ID);
  expect(declaredGroupId("mi-tienda")).toBe(declaredGroupId("mi-tienda"));
  expect(declaredGroupId("mi-tienda")).not.toBe(declaredGroupId("otra-tienda"));
  expect(groupIdentity(declaredGroupId("mi-tienda"))).toBeTruthy();
  expect(() => declaredGroupId("Bad Name")).toThrow(expect.objectContaining({ code: "GROUP_NAME_INVALID" }));
});
