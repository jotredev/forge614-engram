/**
 * Las claves de identidad de Git conservan los puertos personalizados. La normalización histórica
 * de D6 ignoraba puertos y credenciales, por lo que solo sirve para compatibilidad.
 */

import { findSecret } from "../../shared/secrets";

// Reconoce si el texto trae esquema (protocolo, la parte antes de "://"): https://, http://, ssh://,
// git:// o git+ssh://. Sin esquema y con ":" antes de la primera "/", es la forma scp de Git
// (usuario@host:ruta), que se reescribe a host/ruta antes de seguir.
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu;
const SCP_FORM = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/u;

const IDENTITY_URL = /^(https?|ssh|git|git\+ssh):\/\/([^/]+)(\/.*)$/iu;
const IDENTITY_SCP = /^(?:([\w.-]+)@)?(\[[\da-f:.]+\]|[\w.-]+):(.+)$/iu;
const DEFAULT_PORTS: Record<string, number> = { http: 80, https: 443, ssh: 22, git: 9418, "git+ssh": 22 };
const AMBIGUOUS_URL_CHARS = /[\s\\?#\u0000-\u001f\u007f]/u;

/** Clave de catálogo derivada de un origin Git de red, sin usuario ni credenciales. */
export function normalizeIdentityOrigin(raw: string): string | null {
  const value = raw.trim();
  if (AMBIGUOUS_URL_CHARS.test(value) || /^[a-z]:/iu.test(value) || findSecret(value)) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (AMBIGUOUS_URL_CHARS.test(decoded) || findSecret(decoded)) return null;
  } catch { return null; }

  const url = IDENTITY_URL.exec(value);
  if (url) {
    const [, scheme, authority, path] = url;
    return identityKey(scheme!.toLowerCase(), authority!, path!);
  }
  const scp = IDENTITY_SCP.exec(value);
  if (!scp || SCHEME.test(value)) return null;
  const [, user, host, path] = scp;
  // Una ruta relativa para otra cuenta SSH depende de su directorio personal.
  if (user && user !== "git" && !path!.startsWith("/")) return null;
  return identityKey("ssh", user ? `${user}@${host}` : host!, path!);
}

function identityKey(scheme: string, authority: string, path: string): string | null {
  const parts = /^(?:([\w.-]+)@)?(\[[\da-f:.]+\]|[a-z\d](?:[a-z\d.-]*[a-z\d])?)(?::(\d+))?$/iu.exec(authority);
  if (!parts) return null;
  const [, user, host, port] = parts;
  if (user && scheme !== "ssh" && scheme !== "git+ssh") return null;
  const number = port === undefined ? null : Number(port);
  if (number !== null && (number < 1 || number > 65535)) return null;
  // URL comprueba la sintaxis de IPv6 entre corchetes sin reinterpretar la ruta.
  if (host!.startsWith("[")) {
    try { new URL(`http://${host}`); } catch { return null; }
  }
  const repository = path.replace(/^\//u, "").replace(/\/+$/u, "").replace(/\.git$/iu, "");
  if (!repository || repository.split("/").some(part => !part || /^(?:\.|%2e){1,2}$/iu.test(part))) return null;
  const endpoint = number === null || number === DEFAULT_PORTS[scheme] ? host : `${host}:${number}`;
  return `${endpoint!.toLowerCase()}/${repository}`;
}

/** La copia de compatibilidad histórica ignora el puerto. Recibe una clave de catálogo. */
export function legacyOriginKey(origin: string): string {
  const slash = origin.indexOf("/");
  return origin.slice(0, slash).replace(/:\d+$/u, "") + origin.slice(slash);
}

/**
 * Normaliza la URL de un remoto de Git a la forma `host/ruta`, para que dos formas distintas del
 * mismo remoto (con o sin `.git`, `https://` o `ssh://`/scp, con o sin credenciales embebidas, con o
 * sin puerto, host en mayúsculas o minúsculas) comparen iguales.
 * @param url Texto del remoto, tal como aparece en `git remote -v` o en la línea `url` del archivo
 * `config` de Git.
 * @returns La forma normalizada `host/ruta` (p. ej. `github.com/org/repo`), sin esquema, sin
 * credenciales ni usuario, sin puerto, sin `/` final ni `.git` final, con el host en minúsculas y la
 * ruta tal cual (conserva mayúsculas). Si `url` no tiene forma reconocible de remoto (una ruta local,
 * un texto vacío), se devuelve solo recortado (trim), sin inventar una identidad.
 */
export function normalizeRemote(url: string): string {
  // Se recorta antes que nada: los espacios sobrantes no son parte de la identidad del remoto.
  let value = url.trim();
  if (!value) return value;
  const scp = SCP_FORM.exec(value);
  if (SCHEME.test(value)) {
    // Con esquema (https://, ssh://, git://, git+ssh://, ...): se quita, queda solo la autoridad y la ruta.
    value = value.replace(SCHEME, "");
  } else if (scp) {
    // Sin esquema pero con la forma scp (usuario@host:ruta): se reescribe a host/ruta, como si trajera ssh://.
    value = `${scp[1]}/${scp[2]}`;
  }
  // A partir de aquí, "autoridad" es todo antes de la primera "/" (host, usuario y puerto); "resto" es
  // la ruta con esa primera "/" incluida (o vacío si no había ninguna, p. ej. una ruta local sin "/").
  const firstSlash = value.indexOf("/");
  let authority = firstSlash === -1 ? value : value.slice(0, firstSlash);
  let rest = firstSlash === -1 ? "" : value.slice(firstSlash);
  // Credenciales o usuario: todo lo que va antes de la última "@" de la autoridad se descarta.
  const at = authority.lastIndexOf("@");
  if (at !== -1) authority = authority.slice(at + 1);
  // Puerto (":443", ":22", cualquiera): se quita del final de la autoridad.
  authority = authority.replace(/:\d+$/u, "");
  // El host se guarda en minúsculas (dos hosts que difieren solo en mayúsculas son el mismo remoto).
  authority = authority.toLowerCase();
  // "/" final, luego ".git" final, y de nuevo un "/" final si queda uno (en ese orden, como pide D6).
  rest = rest.replace(/\/+$/u, "").replace(/\.git$/iu, "").replace(/\/+$/u, "");
  return `${authority}${rest}`;
}

/**
 * Decide a qué proyecto ya conocido corresponde un remoto entrante, comparando su forma normalizada
 * contra la de cada proyecto con remoto anotado. Nunca adivina: si ningún proyecto coincide, o si más
 * de uno coincide (dos proyectos con el mismo remoto, algo que D6 nunca debe ligar a ciegas), no
 * devuelve ninguno.
 * @param remote Remoto entrante, en cualquier forma (se normaliza aquí, no hace falta normalizarlo antes).
 * @param knownProjects Proyectos ya conocidos con su remoto anotado (`origin`), o `null` si ese
 * proyecto todavía no tiene uno anotado; los `null` no participan en la comparación.
 * @returns El `projectId` del único proyecto cuyo remoto normalizado coincide con `remote`, o `null`
 * si no hay ninguna coincidencia o hay más de una.
 */
export function matchProjectByRemote(remote: string, knownProjects: { projectId: string; origin: string | null }[]): string | null {
  const normalized = normalizeRemote(remote);
  // Los proyectos sin remoto anotado (origin null) no cuentan como coincidencia posible.
  const matches = knownProjects.filter(project => project.origin !== null && normalizeRemote(project.origin) === normalized);
  return matches.length === 1 ? matches[0]!.projectId : null;
}
