import type { AlignedRow, Alignment } from './align';
import { summarizeFields } from './fields';

/**
 * A divergence is a MAXIMAL RUN of consecutive non-identical rows — not a
 * single row.
 *
 * This matters for the core interaction. "B retried and A didn't" is one
 * behavioural event that spans `retry + tool_call + tool_result + error`.
 * If `n` stepped per-row, reaching the next real event would take four
 * presses and the five-second criterion would fail.
 */

export type DivergenceKind = 'changed' | 'onlyA' | 'onlyB' | 'structural';

export interface Divergence {
  /** Ordinal in the divergence list — what `n` / `p` navigate. */
  index: number;
  startRow: number;
  /** Inclusive. */
  endRow: number;
  rows: AlignedRow[];
  kind: DivergenceKind;
  /** Terse mechanical characterization for the divergence rail. Never prose. */
  summary: string;
}

export function divergences(alignment: Alignment): Divergence[] {
  const out: Divergence[] = [];
  const rows = alignment.rows;
  let i = 0;

  while (i < rows.length) {
    if (rows[i].kind === 'identical') {
      i++;
      continue;
    }
    const start = i;
    while (i < rows.length && rows[i].kind !== 'identical') i++;
    const run = rows.slice(start, i);
    out.push({
      index: out.length,
      startRow: start,
      endRow: i - 1,
      rows: run,
      kind: kindOf(run),
      summary: summarize(run),
    });
  }

  return out;
}

function kindOf(run: AlignedRow[]): DivergenceKind {
  const kinds = new Set(run.map((r) => r.kind));
  if (kinds.size === 1) return [...kinds][0] as DivergenceKind;
  return 'structural';
}

function summarize(run: AlignedRow[]): string {
  const head = run[0];

  // Lead with the FIRST row when it is a changed pair: that row IS the
  // divergence point. What follows it may or may not be fallout from it — the
  // tool does not know and does not claim to. It reports where the runs first
  // observably differ, then the extent of the run.
  if (head.kind === 'changed') {
    const headline = changedSummary(head);
    if (run.length === 1) return headline;
    return `${headline} → ${extent(run)}`;
  }

  if (run.length === 1) {
    const step = head.a ?? head.b;
    return `${head.kind === 'onlyA' ? '−' : '+'} ${step?.anchor ?? '?'}`;
  }

  const anchors = [...new Set(run.map((r) => (r.a ?? r.b)?.anchor).filter(Boolean))];
  const shown = anchors.slice(0, 3).join(', ');
  const rest = Math.max(0, anchors.length - 3);
  return `${extent(run)} · ${shown}${rest > 0 ? ` +${rest}` : ''}`;
}

function changedSummary(row: AlignedRow): string {
  const anchor = (row.a ?? row.b)?.anchor ?? '?';
  // Enum-valued single-field changes read better as a transition.
  if (row.fields?.length === 1) {
    const f = row.fields[0];
    if (f.op === 'changed' && isScalar(f.before) && isScalar(f.after)) {
      return `${anchor} · ${short(f.path)} ${fmt(f.before)} → ${fmt(f.after)}`;
    }
  }
  return `${anchor} · ${summarizeFields(row.fields ?? [])}`;
}

function extent(run: AlignedRow[]): string {
  const onlyA = run.filter((r) => r.kind === 'onlyA').length;
  const onlyB = run.filter((r) => r.kind === 'onlyB').length;
  const changed = run.filter((r) => r.kind === 'changed').length;

  const parts: string[] = [];
  if (onlyB) parts.push(`+${onlyB} in B`);
  if (onlyA) parts.push(`−${onlyA} in A`);
  if (changed) parts.push(`${changed} changed`);
  return parts.join(', ');
}

function isScalar(v: unknown): boolean {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

function fmt(v: unknown): string {
  if (typeof v === 'string') return v.length > 24 ? `"${v.slice(0, 21)}…"` : `"${v}"`;
  return String(v);
}

/** "args.limit" → "limit"; single-segment paths pass through. */
function short(path: string): string {
  const i = path.lastIndexOf('.');
  return i === -1 ? path : path.slice(i + 1);
}
