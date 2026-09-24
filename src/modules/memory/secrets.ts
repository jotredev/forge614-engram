// Credentials that must never be stored in memory. The id names the kind of secret so the
// caller can say what to remove; the matched value is never returned or echoed.
const SECRET_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["private-key", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/u],
  ["aws-access-key-id", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/u],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/u],
  ["sk-key", /\bsk-(?:[A-Za-z0-9_-]{2,20}-)?[A-Za-z0-9]{32,}\b/u],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/u],
  ["connection-string-with-credentials", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/iu],
];

// A keyword assigned a literal value. The value must end at a quote, space, comma, semicolon or the
// end of the text, so placeholders (<...>), paths and calls never match.
const ASSIGNMENT = /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?([A-Za-z0-9+=_.!@#$%^&*~-]{8,})(?=["'\s,;]|$)/giu;
// Values that name a secret instead of holding it: environment variable names, dotted code references and masks.
const NOT_A_VALUE = /^(?:[A-Z]+|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|\*+)$/u;

/** Id of the first secret pattern found in the text, or null. */
export function findSecret(text: string): string | null {
  for (const [id, pattern] of SECRET_PATTERNS) if (pattern.test(text)) return id;
  for (const match of text.matchAll(ASSIGNMENT)) if (!NOT_A_VALUE.test(match[1]!)) return "password-assignment";
  return null;
}
