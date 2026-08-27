import type { NormalizedStep, NormalizedTrace } from '../schema/types';
import { fieldDiff, type FieldDiff } from './fields';
import { similarity } from './similarity';

/**
 * Weighted global alignment (Needleman–Wunsch) over anchor-equal pairings.
 *
 * Plain LCS maximizes match COUNT, which is indifferent between competing
 * pairings when an anchor repeats — the outcome then falls out of the
 * implementation's tie-break rather than out of the data. We instead maximize
 * a continuous score, so the pairing with the most local evidence wins.
 *
 * See docs/alignment.md for the full specification.
 */

export const M_BASE = 1.0;
export const M_SIM = 1.0;
export const GAP = -0.6;

/**
 * Guarantees `worst match > delete + insert`, i.e. anchor-equal steps always
 * prefer to pair. This is what makes "changed arguments" read as CHANGED
 * instead of DELETE + INSERT.
 */
export const PREFERS_PAIRING = M_BASE > 2 * GAP;

/** Refuse rather than freeze the tab. ~2000×2000 steps. */
export const MAX_CELLS = 4_000_000;

export class AlignmentTooLargeError extends Error {
  readonly n: number;
  readonly m: number;

  constructor(n: number, m: number) {
    super(
      `Cannot align ${n}×${m} steps (${n * m} cells, limit ${MAX_CELLS}). ` +
        `V1 targets traces up to ~1,000 steps.`,
    );
    this.name = 'AlignmentTooLargeError';
    this.n = n;
    this.m = m;
  }
}

export type RowKind = 'identical' | 'changed' | 'onlyA' | 'onlyB';

export interface AlignedRow {
  /** Position in the aligned sequence. */
  index: number;
  kind: RowKind;
  a?: NormalizedStep;
  b?: NormalizedStep;
  /** Local similarity of the pairing, for matched rows. Diagnostic. */
  sim?: number;
  /** Present iff kind === 'changed'. Never empty when present. */
  fields?: FieldDiff[];
}

export interface Alignment {
  rows: AlignedRow[];
  counts: Record<RowKind, number>;
  /** Index into `rows` of the first non-identical row, or -1. */
  firstDivergenceRow: number;
  /** True when the DP was skipped because anchor sequences matched exactly. */
  fastPath: boolean;
}

const DIAG = 1;
const UP = 2; // consume A → onlyA
const LEFT = 3; // consume B → onlyB

export function align(ta: NormalizedTrace, tb: NormalizedTrace): Alignment {
  const A = ta.steps;
  const B = tb.steps;
  const n = A.length;
  const m = B.length;

  if (n * m > MAX_CELLS) throw new AlignmentTooLargeError(n, m);

  const ops = sameAnchorSequence(A, B)
    ? { path: new Array<number>(n).fill(DIAG), fastPath: true }
    : { path: traceback(A, B), fastPath: false };

  return classify(A, B, ops.path, ops.fastPath);
}

function sameAnchorSequence(A: NormalizedStep[], B: NormalizedStep[]): boolean {
  if (A.length !== B.length) return false;
  for (let i = 0; i < A.length; i++) if (A[i].anchor !== B[i].anchor) return false;
  return true;
}

function traceback(A: NormalizedStep[], B: NormalizedStep[]): number[] {
  const n = A.length;
  const m = B.length;
  const w = m + 1;

  const score = new Float64Array((n + 1) * w);
  const from = new Uint8Array((n + 1) * w);

  for (let i = 1; i <= n; i++) {
    score[i * w] = i * GAP;
    from[i * w] = UP;
  }
  for (let j = 1; j <= m; j++) {
    score[j] = j * GAP;
    from[j] = LEFT;
  }

  for (let i = 1; i <= n; i++) {
    const a = A[i - 1];
    for (let j = 1; j <= m; j++) {
      const b = B[j - 1];

      // Hard constraint: only anchor-equal steps may be paired.
      let best: number;
      let dir: number;
      if (a.anchor === b.anchor) {
        best = score[(i - 1) * w + (j - 1)] + M_BASE + M_SIM * similarity(a, b, A, B);
        dir = DIAG;
      } else {
        best = -Infinity;
        dir = DIAG;
      }

      // Strict improvement only — diagonal wins ties, then UP, then LEFT.
      const up = score[(i - 1) * w + j] + GAP;
      if (up > best) {
        best = up;
        dir = UP;
      }
      const left = score[i * w + (j - 1)] + GAP;
      if (left > best) {
        best = left;
        dir = LEFT;
      }

      score[i * w + j] = best;
      from[i * w + j] = dir;
    }
  }

  const path: number[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i === 0) {
      path.push(LEFT);
      j--;
      continue;
    }
    if (j === 0) {
      path.push(UP);
      i--;
      continue;
    }
    const dir = from[i * w + j];
    path.push(dir);
    if (dir === DIAG) {
      i--;
      j--;
    } else if (dir === UP) i--;
    else j--;
  }
  path.reverse();
  return orderGapRuns(path);
}

/**
 * Within a maximal run of unmatched rows, emit all A-deletions before all
 * B-insertions.
 *
 * Unmatched rows are, by definition, not aligned to each other, so their
 * interleaving carries no information — the DP's ordering there is an artifact
 * of the traceback. Fixing it to `−` then `+` matches diff convention and makes
 * the compare view read as "what A did / what B did instead". Stable: relative
 * order within each side is preserved, and no pairing changes.
 */
function orderGapRuns(path: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === DIAG) {
      out.push(DIAG);
      i++;
      continue;
    }
    let j = i;
    let ups = 0;
    let lefts = 0;
    while (j < path.length && path[j] !== DIAG) {
      if (path[j] === UP) ups++;
      else lefts++;
      j++;
    }
    for (let k = 0; k < ups; k++) out.push(UP);
    for (let k = 0; k < lefts; k++) out.push(LEFT);
    i = j;
  }
  return out;
}

function classify(
  A: NormalizedStep[],
  B: NormalizedStep[],
  path: number[],
  fastPath: boolean,
): Alignment {
  const rows: AlignedRow[] = [];
  const counts: Record<RowKind, number> = { identical: 0, changed: 0, onlyA: 0, onlyB: 0 };
  let i = 0;
  let j = 0;

  for (const dir of path) {
    if (dir === DIAG) {
      const a = A[i++];
      const b = B[j++];
      // Behavioural signature only; `analysis` plays no part (see signature.ts).
      if (a.signature === b.signature) {
        rows.push({ index: rows.length, kind: 'identical', a, b, sim: 1 });
        counts.identical++;
      } else {
        const fields = fieldDiff(a.step, b.step);
        rows.push({
          index: rows.length,
          kind: 'changed',
          a,
          b,
          sim: similarity(a, b, A, B),
          fields,
        });
        counts.changed++;
      }
    } else if (dir === UP) {
      rows.push({ index: rows.length, kind: 'onlyA', a: A[i++] });
      counts.onlyA++;
    } else {
      rows.push({ index: rows.length, kind: 'onlyB', b: B[j++] });
      counts.onlyB++;
    }
  }

  const firstDivergenceRow = rows.findIndex((r) => r.kind !== 'identical');
  return { rows, counts, firstDivergenceRow, fastPath };
}
