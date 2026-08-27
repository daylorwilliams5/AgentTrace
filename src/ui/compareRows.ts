import type { AlignedRow, RowKind } from '../core/diff/align';

/** Runs shorter than this stay expanded — folding two rows saves nothing. */
export const FOLD_MIN = 3;

/** `=` identical · `~` changed · `−` only in A · `+` only in B */
export const GLYPH: Record<RowKind, string> = {
  identical: '=',
  changed: '~',
  onlyA: '\u2212',
  onlyB: '+',
};

export type Disp =
  | { t: 'row'; row: AlignedRow }
  | { t: 'fold'; startRow: number; count: number };

/**
 * Collapse maximal runs of identical rows into a single fold row. This is the
 * highest-leverage behaviour in compare mode: a 200-step comparison becomes the
 * handful of places the runs actually differ.
 */
export function buildDisplay(rows: AlignedRow[], fold: boolean, expanded: Set<number>): Disp[] {
  const out: Disp[] = [];
  let i = 0;
  while (i < rows.length) {
    if (fold && rows[i].kind === 'identical') {
      let j = i;
      while (j < rows.length && rows[j].kind === 'identical') j++;
      if (j - i >= FOLD_MIN && !expanded.has(i)) {
        out.push({ t: 'fold', startRow: i, count: j - i });
        i = j;
        continue;
      }
    }
    out.push({ t: 'row', row: rows[i] });
    i++;
  }
  return out;
}
