import type { NormalizedStep } from '../schema/types';
import { canonicalJson, clamp01, eq, jaccard, leafPaths, tokens } from '../util/json';

/**
 * Local similarity between two steps that ALREADY share an anchor.
 *
 * This exists solely to disambiguate repeated anchors: when three `search`
 * calls in A must be matched against two in B, similarity decides which
 * occurrences pair. It never decides *whether* to pair — the gap penalty in
 * align.ts guarantees that anchor-equal steps always prefer pairing.
 *
 * Every feature is lexical, structural, or exact-match. No embeddings, no
 * model calls, no randomness, no dependence on key order.
 *
 * See docs/alignment.md §4 for the weight table.
 */

interface Weights {
  payload: number;
  ctx: number;
  ord: number;
  pos: number;
  attempt: number;
  callSim: number;
}

const W_DEFAULT: Weights = { payload: 0.6, ctx: 0.2, ord: 0.12, pos: 0.08, attempt: 0, callSim: 0 };
const W_TOOL_CALL: Weights = { payload: 0.55, ctx: 0.2, ord: 0.12, pos: 0.08, attempt: 0.05, callSim: 0 };
const W_TOOL_RESULT: Weights = { payload: 0.35, ctx: 0.2, ord: 0.12, pos: 0.08, attempt: 0, callSim: 0.25 };

function weightsFor(type: string): Weights {
  if (type === 'tool_call') return W_TOOL_CALL;
  if (type === 'tool_result') return W_TOOL_RESULT;
  return W_DEFAULT;
}

export function similarity(
  a: NormalizedStep,
  b: NormalizedStep,
  A: NormalizedStep[],
  B: NormalizedStep[],
): number {
  const w = weightsFor(a.step.type);
  let score =
    w.payload * payloadSimilarity(a, b) +
    w.ctx * contextSimilarity(a.index, b.index, A, B) +
    w.ord * ordinalSimilarity(a.ordinal, b.ordinal) +
    w.pos * positionSimilarity(a.index, b.index, A.length, B.length);

  if (w.attempt > 0) score += w.attempt * eq(a.step.attempt, b.step.attempt);
  if (w.callSim > 0) score += w.callSim * argSimilarity(a.callArgs, b.callArgs);

  return clamp01(score);
}

// --- structural features ---------------------------------------------------

/** Neighbour-anchor agreement. Both-out-of-bounds counts as agreement. */
export function contextSimilarity(
  i: number,
  j: number,
  A: NormalizedStep[],
  B: NormalizedStep[],
): number {
  const prev = sideAgreement(A[i - 1]?.anchor, B[j - 1]?.anchor);
  const next = sideAgreement(A[i + 1]?.anchor, B[j + 1]?.anchor);
  return (prev + next) / 2;
}

function sideAgreement(x: string | undefined, y: string | undefined): number {
  if (x === undefined && y === undefined) return 1;
  if (x === undefined || y === undefined) return 0;
  return x === y ? 1 : 0;
}

/** Proximity of "which occurrence of this anchor is this". */
export function ordinalSimilarity(oa: number, ob: number): number {
  return 1 / (1 + Math.abs(oa - ob));
}

export function positionSimilarity(i: number, j: number, n: number, m: number): number {
  const na = n <= 1 ? 0 : i / (n - 1);
  const nb = m <= 1 ? 0 : j / (m - 1);
  return 1 - Math.abs(na - nb);
}

// --- payload features ------------------------------------------------------

function payloadSimilarity(a: NormalizedStep, b: NormalizedStep): number {
  const sa = a.step;
  const sb = b.step;
  if (sa.type !== sb.type) return 0; // unreachable: anchors encode type

  switch (sa.type) {
    case 'model': {
      const other = sb as typeof sa;
      return 0.7 * jaccard(tokens(sa.output), tokens(other.output)) +
        0.3 * eq(sa.stopReason, other.stopReason);
    }
    case 'tool_call': {
      const other = sb as typeof sa;
      return argSimilarity(sa.args, other.args);
    }
    case 'tool_result': {
      const other = sb as typeof sa;
      return (
        0.4 * (sa.ok === other.ok ? 1 : 0) +
        0.3 * eq(sa.error?.kind, other.error?.kind) +
        0.3 * jaccard(pathSet(sa.result ?? null), pathSet(other.result ?? null))
      );
    }
    case 'retry': {
      const other = sb as typeof sa;
      return 0.5 * (sa.attempt === other.attempt ? 1 : 0) + 0.5 * eq(sa.reason, other.reason);
    }
    case 'error': {
      const other = sb as typeof sa;
      return 0.5 * eq(sa.kind, other.kind) + 0.5 * jaccard(tokens(sa.message), tokens(other.message));
    }
    case 'stop': {
      const other = sb as typeof sa;
      return sa.reason === other.reason ? 1 : 0;
    }
    case 'state': {
      const other = sb as typeof sa;
      return jaccard(
        new Set(sa.changes.map((c) => c.path)),
        new Set(other.changes.map((c) => c.path)),
      );
    }
  }
}

/**
 * Argument similarity: half for having the same shape, half for agreeing on
 * the values at shared paths. This is the signal that lets `search(id=X)`
 * find `search(id=X)` two positions away instead of the adjacent
 * `search(query=X)`.
 */
export function argSimilarity(a: unknown, b: unknown): number {
  const pa = leafPaths(a ?? null);
  const pb = leafPaths(b ?? null);
  const shape = jaccard(new Set(pa.keys()), new Set(pb.keys()));

  let shared = 0;
  let agree = 0;
  for (const [k, v] of pa) {
    if (!pb.has(k)) continue;
    shared++;
    if (canonicalJson(v) === canonicalJson(pb.get(k))) agree++;
  }
  const values = shared === 0 ? 0 : agree / shared;

  return 0.5 * shape + 0.5 * values;
}

function pathSet(value: unknown): Set<string> {
  return new Set(leafPaths(value).keys());
}
