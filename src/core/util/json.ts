/**
 * Deterministic JSON utilities. Everything here must be order-independent and
 * pure — the alignment must produce byte-identical results across runs and
 * across platforms, so nothing may depend on object key insertion order.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Stable stringify: object keys sorted, undefined dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      if (src[k] === undefined) continue;
      out[k] = canonicalize(src[k]);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return value;
}

/** FNV-1a 32-bit, hex. Short, stable, non-cryptographic — sufficient for keys. */
export function hash32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Flatten to leaf paths. Arrays are indexed; empty containers are themselves
 * leaves so that `{a: {}}` and `{a: {b: 1}}` are distinguishable.
 */
export function leafPaths(
  value: unknown,
  prefix = '',
  out: Map<string, unknown> = new Map(),
): Map<string, unknown> {
  if (value === null || typeof value !== 'object') {
    out.set(prefix || '$', value);
    return out;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) out.set(prefix || '$', '[]');
    else value.forEach((v, i) => leafPaths(v, `${prefix}[${i}]`, out));
    return out;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  if (keys.length === 0) {
    out.set(prefix || '$', '{}');
    return out;
  }
  for (const k of keys) {
    const next = prefix ? `${prefix}.${k}` : k;
    leafPaths((value as Record<string, unknown>)[k], next, out);
  }
  return out;
}

/** Lowercased word tokens, deduped. Used for lexical similarity only. */
export function tokens(text: string | undefined): Set<string> {
  if (!text) return new Set();
  const out = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/[a-z0-9_]+/g)) {
    if (m[0].length > 1) out.add(m[0]);
  }
  return out;
}

/** Jaccard index. Two empty sets are identical (1), not undefined. */
export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const v of small) if (large.has(v)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 1 when both absent (absence is agreement), 1 when equal, else 0. */
export function eq(a: unknown, b: unknown): number {
  if (a === undefined && b === undefined) return 1;
  if (a === undefined || b === undefined) return 0;
  return canonicalJson(a) === canonicalJson(b) ? 1 : 0;
}

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
