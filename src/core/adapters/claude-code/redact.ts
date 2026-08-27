/**
 * Redaction and secret sweeping.
 *
 * Two independent jobs:
 *   1. `redact()` removes machine- and person-identifying detail at a chosen
 *      level. It must be BYTE-DETERMINISTIC — a length-varying truncation would
 *      make two identical tool results diff, and the comparison would then be
 *      measuring the redactor rather than the agent.
 *   2. `scanSecrets()` is unconditional and fails closed. Better to refuse the
 *      export than to quietly write a key into a fixture.
 */

export type RedactLevel = 'none' | 'paths' | 'strict';

/** Deterministic cap for `strict`. Same input always yields the same output. */
const STRICT_MAX = 2048;

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ['anthropic api key', /\bsk-ant-[A-Za-z0-9_-]{16,}/],
  ['openai api key', /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/],
  ['aws access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['github token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/],
  ['google api key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['bearer token', /\bBearer\s+[A-Za-z0-9._-]{24,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['env assignment', /\b(?:SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API_KEY|ACCESS_KEY)\s*[=:]\s*["']?[A-Za-z0-9/+_-]{16,}/i],
];

export interface SecretHit {
  kind: string;
  /** Where it was found, e.g. "steps[12].result.stdout". */
  where: string;
}

/** Walks every string in the value. Never returns the secret itself. */
export function scanSecrets(value: unknown, where = '$', hits: SecretHit[] = []): SecretHit[] {
  if (typeof value === 'string') {
    for (const [kind, re] of SECRET_PATTERNS) {
      if (re.test(value)) hits.push({ kind, where });
    }
    return hits;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => scanSecrets(v, `${where}[${i}]`, hits));
    return hits;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      scanSecrets(v, `${where}.${k}`, hits);
    }
  }
  return hits;
}

export interface RedactOptions {
  level: RedactLevel;
  /** Absolute home directory to fold to `~`. */
  home?: string;
}

export function redactString(s: string, o: RedactOptions): string {
  if (o.level === 'none') return s;
  let out = o.home ? s.split(o.home).join('~') : s;
  if (o.level === 'strict' && out.length > STRICT_MAX) {
    // Deterministic: identical inputs always produce identical output.
    out = `${out.slice(0, STRICT_MAX)}\n…[${out.length - STRICT_MAX} more characters removed by redaction]`;
  }
  return out;
}

/** Keys dropped entirely at `strict` — whole-file snapshots, not agent behaviour. */
const STRICT_DROP_KEYS = new Set(['originalFile', 'structuredPatch', 'oldString', 'newString']);

export function redact(value: unknown, o: RedactOptions): unknown {
  if (o.level === 'none') return value;
  if (typeof value === 'string') return redactString(value, o);
  if (Array.isArray(value)) return value.map((v) => redact(v, o));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (o.level === 'strict' && STRICT_DROP_KEYS.has(k)) {
        out[k] = '[removed by redaction]';
        continue;
      }
      out[k] = redact(v, o);
    }
    return out;
  }
  return value;
}
