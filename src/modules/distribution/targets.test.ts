import { expect, test } from "bun:test";
import {
  parseSha256Sums,
  RELEASE_TARGETS,
  selectReleaseTarget,
  verifyManifestEntry,
} from "./targets";

test("selects the exact standalone artifact for every supported host", () => {
  expect(selectReleaseTarget("darwin", "arm64")).toBe("forge614-engram-darwin-arm64");
  expect(selectReleaseTarget("darwin", "x64")).toBe("forge614-engram-darwin-x64");
  expect(selectReleaseTarget("linux", "x64")).toBe("forge614-engram-linux-x64");
  expect(selectReleaseTarget("linux", "arm64")).toBe("forge614-engram-linux-arm64");
  expect(selectReleaseTarget("win32", "x64")).toBe("forge614-engram-windows-x64.exe");
  expect(selectReleaseTarget("win32", "arm64")).toBe("forge614-engram-windows-arm64.exe");
  expect(() => selectReleaseTarget("freebsd", "x64")).toThrow("Unsupported platform");
  expect(() => selectReleaseTarget("linux", "x86_64")).toThrow("Unsupported architecture");
});

test("defines only the six supported release targets", () => {
  expect(RELEASE_TARGETS).toEqual([
    { platform: "darwin", architecture: "arm64", artifact: "forge614-engram-darwin-arm64" },
    { platform: "darwin", architecture: "x64", artifact: "forge614-engram-darwin-x64" },
    { platform: "linux", architecture: "x64", artifact: "forge614-engram-linux-x64" },
    { platform: "linux", architecture: "arm64", artifact: "forge614-engram-linux-arm64" },
    { platform: "win32", architecture: "x64", artifact: "forge614-engram-windows-x64.exe" },
    { platform: "win32", architecture: "arm64", artifact: "forge614-engram-windows-arm64.exe" },
  ]);
});

test("accepts one exact SHA256SUMS entry", () => {
  const manifest = parseSha256Sums("a".repeat(64) + "  forge614-engram-linux-x64\n");

  expect(verifyManifestEntry(manifest, "forge614-engram-linux-x64", "a".repeat(64))).toBe(true);
});

test("rejects duplicate or malformed SHA256SUMS entries", () => {
  expect(() => parseSha256Sums("bad  binary\n")).toThrow("SHA256SUMS");
  expect(() => parseSha256Sums("A".repeat(64) + "  forge614-engram-linux-x64\n")).toThrow("SHA256SUMS");
  expect(() => parseSha256Sums("a".repeat(64) + " forge614-engram-linux-x64\n")).toThrow("SHA256SUMS");
  expect(() => parseSha256Sums("a".repeat(64) + "  forge614-engram-linux-x64\n" + "b".repeat(64) + "  forge614-engram-linux-x64\n")).toThrow("duplicate");
  expect(() => parseSha256Sums("a".repeat(64) + "  forge614-engram-linux-x64\n" + "b".repeat(64) + "  forge614-engram-darwin-x64/other\n")).toThrow("artifact");
  expect(() => parseSha256Sums("a".repeat(64) + "   forge614-engram-linux-x64\n")).toThrow("SHA256SUMS");
});

test("rejects untrusted artifacts and invalid digests during verification", () => {
  const digest = "a".repeat(64);
  const manifest = parseSha256Sums(`${digest}  forge614-engram-linux-x64\n`);

  expect(verifyManifestEntry(manifest, "forge614-engram-linux-x64", digest)).toBe(true);
  expect(verifyManifestEntry(manifest, "forge614-engram-linux-x64", "b".repeat(64))).toBe(false);
  expect(() => verifyManifestEntry(manifest, "../forge614-engram-linux-x64", digest)).toThrow("artifact");
  expect(() => verifyManifestEntry(manifest, "unknown-artifact", digest)).toThrow("artifact");
  expect(() => verifyManifestEntry(manifest, "forge614-engram-linux-x64", "not-a-digest")).toThrow("digest");
});
