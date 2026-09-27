/** Comprueba la selección de binario por plataforma/arquitectura y la lectura y verificación del archivo SHA256SUMS. */
import { expect, test } from "bun:test";
import {
  parseSha256Sums,
  RELEASE_TARGETS,
  selectReleaseTarget,
  verifyManifestEntry,
} from "./targets";

// Cada plataforma y arquitectura soportada debe resolver al binario exacto; las combinaciones fuera
// de la lista deben fallar con un mensaje que distinga plataforma no soportada de arquitectura no soportada.
test("selects the exact standalone artifact for every supported host", () => {
  expect(selectReleaseTarget("darwin", "arm64")).toBe("forge614-engram-darwin-arm64");
  expect(selectReleaseTarget("darwin", "x64")).toBe("forge614-engram-darwin-x64");
  expect(selectReleaseTarget("linux", "x64")).toBe("forge614-engram-linux-x64");
  expect(selectReleaseTarget("linux", "arm64")).toBe("forge614-engram-linux-arm64");
  expect(() => selectReleaseTarget("freebsd", "x64")).toThrow("Unsupported platform");
  expect(() => selectReleaseTarget("linux", "x86_64")).toThrow("Unsupported architecture");
});

// La lista de binarios publicados es fija: solo los cuatro combos darwin/linux × arm64/x64.
test("defines only the four supported release targets", () => {
  expect(RELEASE_TARGETS).toEqual([
    { platform: "darwin", architecture: "arm64", artifact: "forge614-engram-darwin-arm64" },
    { platform: "darwin", architecture: "x64", artifact: "forge614-engram-darwin-x64" },
    { platform: "linux", architecture: "x64", artifact: "forge614-engram-linux-x64" },
    { platform: "linux", architecture: "arm64", artifact: "forge614-engram-linux-arm64" },
  ]);
});

// Una línea bien formada del archivo SHA256SUMS se interpreta y su huella queda disponible para verificar.
test("accepts one exact SHA256SUMS entry", () => {
  const manifest = parseSha256Sums("a".repeat(64) + "  forge614-engram-linux-x64\n");

  expect(verifyManifestEntry(manifest, "forge614-engram-linux-x64", "a".repeat(64))).toBe(true);
});

// Formato roto, mayúsculas, un solo espacio, binario duplicado o binario desconocido deben rechazarse
// (el archivo SHA256SUMS es la base de la verificación de integridad, así que no se tolera ambigüedad).
test("rejects duplicate or malformed SHA256SUMS entries", () => {
  expect(() => parseSha256Sums("bad  binary\n")).toThrow("SHA256SUMS");
  expect(() => parseSha256Sums("A".repeat(64) + "  forge614-engram-linux-x64\n")).toThrow("SHA256SUMS");
  expect(() => parseSha256Sums("a".repeat(64) + " forge614-engram-linux-x64\n")).toThrow("SHA256SUMS");
  expect(() => parseSha256Sums("a".repeat(64) + "  forge614-engram-linux-x64\n" + "b".repeat(64) + "  forge614-engram-linux-x64\n")).toThrow("duplicate");
  expect(() => parseSha256Sums("a".repeat(64) + "  forge614-engram-linux-x64\n" + "b".repeat(64) + "  forge614-engram-darwin-x64/other\n")).toThrow("artifact");
  expect(() => parseSha256Sums("a".repeat(64) + "   forge614-engram-linux-x64\n")).toThrow("SHA256SUMS");
});

// verifyManifestEntry debe distinguir huella distinta (false) de nombre de binario inválido o formato
// de huella inválido (error): un intento de recorrer rutas (`../…`) también debe rechazarse como artefacto inválido.
test("rejects untrusted artifacts and invalid digests during verification", () => {
  const digest = "a".repeat(64);
  const manifest = parseSha256Sums(`${digest}  forge614-engram-linux-x64\n`);

  expect(verifyManifestEntry(manifest, "forge614-engram-linux-x64", digest)).toBe(true);
  expect(verifyManifestEntry(manifest, "forge614-engram-linux-x64", "b".repeat(64))).toBe(false);
  expect(() => verifyManifestEntry(manifest, "../forge614-engram-linux-x64", digest)).toThrow("artifact");
  expect(() => verifyManifestEntry(manifest, "unknown-artifact", digest)).toThrow("artifact");
  expect(() => verifyManifestEntry(manifest, "forge614-engram-linux-x64", "not-a-digest")).toThrow("digest");
});
