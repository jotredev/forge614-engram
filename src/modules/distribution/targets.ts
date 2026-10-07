/**
 * Define los cinco binarios que se publican en cada versión (uno por sistema operativo y arquitectura de
 * procesador, incluido el `.exe` de Windows) y valida el archivo `SHA256SUMS` (lista de huellas digitales, una por binario, que sirve
 * para comprobar que el archivo descargado es exactamente el que se publicó). Hoy ningún archivo lo usa
 * fuera de su prueba (`targets.test.ts`): el actualizador (`src/infrastructure/updater.ts`) no lo importa.
 * Piezas principales: `RELEASE_TARGETS` (la lista fija de
 * binarios soportados), `selectReleaseTarget` (elige el binario según plataforma y arquitectura),
 * `parseSha256Sums` (interpreta el archivo de huellas) y `verifyManifestEntry` (compara una huella).
 */
export const RELEASE_TARGETS = [
  { platform: "darwin", architecture: "arm64", artifact: "forge614-engram-darwin-arm64" },
  { platform: "darwin", architecture: "x64", artifact: "forge614-engram-darwin-x64" },
  { platform: "linux", architecture: "x64", artifact: "forge614-engram-linux-x64" },
  { platform: "linux", architecture: "arm64", artifact: "forge614-engram-linux-arm64" },
  { platform: "win32", architecture: "x64", artifact: "forge614-engram-windows-x64.exe" },
] as const;

/** Uno de los elementos de `RELEASE_TARGETS`: una combinación concreta de plataforma, arquitectura y nombre de binario. */
type ReleaseTarget = (typeof RELEASE_TARGETS)[number];
/** Mapa de solo lectura de nombre de binario a su huella SHA256 (resumen de 64 caracteres hexadecimales que identifica el contenido exacto de un archivo), tal como se interpreta del archivo `SHA256SUMS` de una versión publicada. */
export type Sha256Manifest = ReadonlyMap<ReleaseTarget["artifact"], string>;

const ARTIFACTS = new Set<string>(RELEASE_TARGETS.map(({ artifact }) => artifact));
const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Devuelve el nombre del binario publicado para una plataforma (`darwin`, `linux`, …) y arquitectura
 * (`arm64`, `x64`, …) dadas, buscando en `RELEASE_TARGETS`.
 * @param platform Nombre de la plataforma tal como lo reporta Node/Bun (p. ej. `process.platform`).
 * @param architecture Nombre de la arquitectura tal como lo reporta Node/Bun (p. ej. `process.arch`).
 * @returns El nombre exacto del archivo binario a descargar.
 * @throws Error con código de mensaje "Unsupported platform" si ninguna plataforma soportada coincide;
 * "Unsupported architecture" si la plataforma existe pero no con esa arquitectura.
 */
export function selectReleaseTarget(platform: string, architecture: string): ReleaseTarget["artifact"] {
  const target = RELEASE_TARGETS.find(
    (candidate) => candidate.platform === platform && candidate.architecture === architecture,
  );

  if (!target) {
    // Se distingue el motivo del error: plataforma no soportada en absoluto, o soportada
    // pero con otra arquitectura de procesador (mensaje más preciso para quien depura).
    if (!RELEASE_TARGETS.some((candidate) => candidate.platform === platform)) {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    throw new Error(`Unsupported architecture: ${architecture}`);
  }

  return target.artifact;
}

/**
 * Interpreta el contenido de un archivo `SHA256SUMS` (una línea por binario: huella, dos espacios y
 * nombre de archivo) y construye el mapa de huellas esperadas.
 * @param text Contenido completo del archivo `SHA256SUMS`, con líneas separadas por `\n`.
 * @returns Mapa de nombre de binario a su huella SHA256 en minúsculas.
 * @throws Error si el archivo está vacío, tiene una línea vacía, una línea con formato distinto de
 * `<64 hex>  <archivo>`, un nombre de binario que no está en `RELEASE_TARGETS`, o un binario repetido.
 */
export function parseSha256Sums(text: string): Sha256Manifest {
  const manifest = new Map<ReleaseTarget["artifact"], string>();
  const lines = text.split("\n");
  // El archivo termina con salto de línea, así que el último elemento tras separar es una cadena vacía;
  // se descarta para no contarlo como una entrada más.
  if (lines.at(-1) === "") lines.pop();

  if (lines.length === 0 || lines.some((line) => line.length === 0)) {
    throw new Error("Invalid SHA256SUMS: empty entry");
  }

  for (const line of lines) {
    // Formato exigido: 64 caracteres hexadecimales en minúscula, exactamente dos espacios y el nombre
    // del binario (así se detecta un solo espacio o mayúsculas como error, no como variante válida).
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

/**
 * Comprueba si la huella de un binario descargado coincide con la huella esperada del manifiesto
 * (mapa de huellas construido con `parseSha256Sums`).
 * @param manifest Mapa de huellas esperadas, ya interpretado del archivo `SHA256SUMS`.
 * @param artifact Nombre del binario a verificar; debe ser uno de los definidos en `RELEASE_TARGETS`.
 * @param digest Huella SHA256 calculada sobre el archivo descargado, en minúsculas.
 * @returns `true` si la huella calculada coincide con la del manifiesto; `false` si no coincide.
 * @throws Error si `artifact` no es un binario reconocido, o si `digest` no tiene la forma de una
 * huella SHA256 válida (evita comparar contra un valor con formato inesperado).
 */
export function verifyManifestEntry(manifest: Sha256Manifest, artifact: string, digest: string): boolean {
  if (!ARTIFACTS.has(artifact)) throw new Error(`Invalid artifact: ${artifact}`);
  if (!SHA256.test(digest)) throw new Error("Invalid digest: expected lowercase SHA256");
  return manifest.get(artifact as ReleaseTarget["artifact"]) === digest;
}
