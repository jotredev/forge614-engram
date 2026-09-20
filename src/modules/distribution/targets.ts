export const RELEASE_TARGETS = [
  { platform: "darwin", architecture: "arm64", artifact: "forge614-engram-darwin-arm64" },
  { platform: "darwin", architecture: "x64", artifact: "forge614-engram-darwin-x64" },
  { platform: "linux", architecture: "x64", artifact: "forge614-engram-linux-x64" },
  { platform: "linux", architecture: "arm64", artifact: "forge614-engram-linux-arm64" },
] as const;

type ReleaseTarget = (typeof RELEASE_TARGETS)[number];
export type Sha256Manifest = ReadonlyMap<ReleaseTarget["artifact"], string>;

const ARTIFACTS = new Set<string>(RELEASE_TARGETS.map(({ artifact }) => artifact));
const SHA256 = /^[a-f0-9]{64}$/;

export function selectReleaseTarget(platform: string, architecture: string): ReleaseTarget["artifact"] {
  const target = RELEASE_TARGETS.find(
    (candidate) => candidate.platform === platform && candidate.architecture === architecture,
  );

  if (!target) {
    if (!RELEASE_TARGETS.some((candidate) => candidate.platform === platform)) {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    throw new Error(`Unsupported architecture: ${architecture}`);
  }

  return target.artifact;
}

export function parseSha256Sums(text: string): Sha256Manifest {
  const manifest = new Map<ReleaseTarget["artifact"], string>();
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();

  if (lines.length === 0 || lines.some((line) => line.length === 0)) {
    throw new Error("Invalid SHA256SUMS: empty entry");
  }

  for (const line of lines) {
    const match = /^([a-f0-9]{64}) {2}(\S+)$/.exec(line);
    if (!match) throw new Error("Invalid SHA256SUMS entry");

    const [, digest, artifact] = match;
    if (!digest || !artifact || !ARTIFACTS.has(artifact)) {
      throw new Error(`Invalid SHA256SUMS artifact: ${artifact ?? ""}`);
    }
    if (manifest.has(artifact as ReleaseTarget["artifact"])) {
      throw new Error(`Invalid SHA256SUMS duplicate artifact: ${artifact}`);
    }
    manifest.set(artifact as ReleaseTarget["artifact"], digest);
  }

  return manifest;
}

export function verifyManifestEntry(manifest: Sha256Manifest, artifact: string, digest: string): boolean {
  if (!ARTIFACTS.has(artifact)) throw new Error(`Invalid artifact: ${artifact}`);
  if (!SHA256.test(digest)) throw new Error("Invalid digest: expected lowercase SHA256");
  return manifest.get(artifact as ReleaseTarget["artifact"]) === digest;
}
