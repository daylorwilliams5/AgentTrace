import type { AlignedRow } from '../../core/diff/align';
import type { Divergence } from '../../core/diff/divergence';
import { leafPaths } from '../../core/util/json';
import type { NormalizedStep } from '../../core/schema/types';
import { canonicalJson } from '../../core/util/json';

/**
 * Re-shapes the EXISTING AlignedRow[] + Divergence[] into what the Trajectory
 * View draws. No new comparison logic: every judgement about what differs was
 * already made by core/diff. This file only decides layout.
 *
 * Three visual states, per the approved design:
 *   SAME       → one compressed band, whatever the step count
 *   DIFFERENT  → a forked region: hero, then compact rows
 *   DETAILS    → not here; the inspector owns it
 */

/** Long same-side runs compress rather than scroll. */
export const GROUP_COMPRESS_OVER = 6;
export const GROUP_COMPRESS_KEEP = 3;

export type Group =
  /** Consecutive paired rows whose content differs. */
  | { kind: 'paired'; rows: AlignedRow[] }
  /** Consecutive rows present in only one run. */
  | { kind: 'solo'; side: 'A' | 'B'; rows: AlignedRow[] };

export interface DifferenceSegment {
  kind: 'difference';
  div: Divergence;
  /**
   * The difference point. One row when the region opens on a changed pair; the
   * whole opening run when it opens on an insertion or deletion.
   */
  hero: AlignedRow[];
  heroKind: 'changed' | 'solo';
  heroSide?: 'A' | 'B';
  /** Everything after the hero, grouped by kind.  */
  groups: Group[];
  /**
   * True when identical behaviour resumes after this region. Drawn as merge
   * geometry — never labelled.
   */
  merges: boolean;
}

export interface SameSegment {
  kind: 'same';
  rows: AlignedRow[];
  /** Distinct plain names in the run, for the band's one-line summary. */
  startRow: number;
}

export type Segment = SameSegment | DifferenceSegment;

export function buildSegments(rows: AlignedRow[], divs: Divergence[]): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;

  for (const div of divs) {
    if (div.startRow > cursor) {
      out.push({ kind: 'same', rows: rows.slice(cursor, div.startRow), startRow: cursor });
    }
    out.push(toDifference(div, rows));
    cursor = div.endRow + 1;
  }

  if (cursor < rows.length) {
    out.push({ kind: 'same', rows: rows.slice(cursor), startRow: cursor });
  }
  return out;
}

function toDifference(div: Divergence, all: AlignedRow[]): DifferenceSegment {
  const rows = div.rows;
  const head = rows[0];

  let hero: AlignedRow[];
  let heroKind: 'changed' | 'solo';
  let heroSide: 'A' | 'B' | undefined;

  if (head.kind === 'changed') {
    hero = [head];
    heroKind = 'changed';
  } else {
    // An insertion or deletion opens the region: the whole opening run is the
    // difference point, since a single unpaired step is not a comparison.
    let n = 0;
    while (n < rows.length && rows[n].kind === head.kind) n++;
    hero = rows.slice(0, n);
    heroKind = 'solo';
    heroSide = head.kind === 'onlyA' ? 'A' : 'B';
  }

  return {
    kind: 'difference',
    div,
    hero,
    heroKind,
    heroSide,
    groups: groupRows(rows.slice(hero.length)),
    merges: div.endRow + 1 < all.length,
  };
}

function groupRows(rows: AlignedRow[]): Group[] {
  const out: Group[] = [];
  let i = 0;
  while (i < rows.length) {
    const kind = rows[i].kind;
    let j = i;
    while (j < rows.length && rows[j].kind === kind) j++;
    const run = rows.slice(i, j);
    if (kind === 'changed') out.push({ kind: 'paired', rows: run });
    else out.push({ kind: 'solo', side: kind === 'onlyA' ? 'A' : 'B', rows: run });
    i = j;
  }
  return out;
}

/* ── hero field tables ───────────────────────────────────────────────────── */

export type HeroOp = 'same' | 'changed' | 'onlyA' | 'onlyB';

export interface HeroField {
  path: string;
  a?: unknown;
  b?: unknown;
  op: HeroOp;
}

/**
 * The side-by-side payload table shown at the difference point.
 *
 * Unlike `fieldDiff`, this keeps UNCHANGED entries too: the reader is looking at
 * what each run passed, not at a changelog, and an argument list with holes in
 * it is harder to read than a complete one. The inspector shows the changelog.
 */
export function heroFields(a: NormalizedStep | undefined, b: NormalizedStep | undefined): HeroField[] {
  const pa = payloadPaths(a);
  const pb = payloadPaths(b);
  if (!pa && !pb) return [];

  const keys = [...new Set([...(pa?.keys() ?? []), ...(pb?.keys() ?? [])])].sort();
  return keys.map((path) => {
    const inA = pa?.has(path) ?? false;
    const inB = pb?.has(path) ?? false;
    const va = pa?.get(path);
    const vb = pb?.get(path);
    let op: HeroOp = 'same';
    if (inA && !inB) op = 'onlyA';
    else if (!inA && inB) op = 'onlyB';
    else if (canonicalJson(va) !== canonicalJson(vb)) op = 'changed';
    return { path, a: va, b: vb, op };
  });
}

/** The part of a step a reader would call "what it passed" or "what came back". */
function payloadPaths(s: NormalizedStep | undefined): Map<string, unknown> | undefined {
  if (!s) return undefined;
  const step = s.step;
  switch (step.type) {
    case 'tool_call':
      return strip(leafPaths(step.args ?? null));
    case 'tool_result':
      return strip(leafPaths(step.result ?? null));
    case 'state':
      return new Map(step.changes.map((c) => [c.path, c.after]));
    default:
      // model / error / retry / stop carry their difference in the label or in
      // free text; both are rendered directly rather than as a field table.
      return undefined;
  }
}

function strip(m: Map<string, unknown>): Map<string, unknown> {
  m.delete('$');
  return m;
}
