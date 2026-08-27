import type { AlignedRow } from '../../core/diff/align';
import type { Divergence } from '../../core/diff/divergence';
import type { FieldDiff } from '../../core/diff/fields';
import type { NormalizedStep, StopReason } from '../../core/schema/types';
import { leafPaths } from '../../core/util/json';
import { fmtValue } from '../format';

/**
 * THE MECHANICAL LEXICON.
 *
 * Every string the Trajectory View shows is produced here, so there is exactly
 * one file to audit for interpretation. The rules:
 *
 *   1. Closed enums defined by OUR schema may get a fixed human label.
 *      `stop.reason` has six values; mapping them to English is a lexicon.
 *   2. Producer-supplied strings (tool names, error kinds, model output) are
 *      rendered VERBATIM. Never reworded, never prettified.
 *   3. Counts and positions are computed, never estimated.
 *   4. Nothing here infers intent, causality, correctness, or severity.
 *
 * Specifically NOT produced here: "verification", "recovered", "root cause",
 * "because", "led to", "correct", "failed to", or any noun invented for a
 * payload field ("Found 1 invoice").
 */

export type Mark = 'ok' | 'fail' | 'neutral' | 'none';

export interface StepLabel {
  mark: Mark;
  /** Primary line. Producer strings appear verbatim. */
  text: string;
  /** Optional second line — an error kind, a retry reason. Also verbatim. */
  sub?: string;
}

/**
 * Rule 1. `stop.reason` is a closed six-value enum in agenttrace/v1, so a fixed
 * label is a lexicon rather than a judgement. The mark renders the trace's OWN
 * reported outcome — it is not AgentTrace assessing whether the run was right.
 */
const STOP_LABEL: Record<StopReason, { mark: Mark; text: string }> = {
  goal_met: { mark: 'ok', text: 'Goal met' },
  max_steps: { mark: 'fail', text: 'Max steps reached' },
  error: { mark: 'fail', text: 'Stopped on error' },
  timeout: { mark: 'fail', text: 'Timed out' },
  user: { mark: 'neutral', text: 'Stopped by user' },
  unknown: { mark: 'neutral', text: 'Stopped' },
};

export const MARK_GLYPH: Record<Mark, string> = {
  ok: '✓',
  fail: '✕',
  neutral: '○',
  none: '',
};

/**
 * Words, not symbols, and only in the inspector. The central trajectory carries
 * no notation the reader has to learn — presence, absence, and side-by-side
 * values do that work.
 */
export const OP_WORD: Record<FieldDiff['op'], string> = {
  removed: 'Removed from Run B',
  added: 'Added in Run B',
  changed: 'Changed',
};

function ordinalWord(n: number): string {
  const v = n + 1;
  if (v === 2) return '2nd';
  if (v === 3) return '3rd';
  return `${v}th`;
}

/**
 * One step, in plain language. Verbs come from the closed step-type enum; every
 * name, kind, and reason is the producer's own string.
 */
export function stepLabel(s: NormalizedStep, all: NormalizedStep[]): StepLabel {
  const step = s.step;
  switch (step.type) {
    case 'model':
      return { mark: 'none', text: 'model output' };

    case 'tool_call': {
      // `ordinal` is already computed in core: how many earlier steps in this
      // run share this anchor. It states position, never purpose.
      const repeat = s.ordinal > 0 ? ` (${ordinalWord(s.ordinal)} call)` : '';
      return { mark: 'none', text: `called ${step.name}${repeat}` };
    }

    case 'tool_result': {
      const name = step.name ?? nameOfPairedCall(s, all) ?? 'result';
      if (!step.ok) return { mark: 'fail', text: name, sub: step.error?.kind ?? step.error?.message };
      // A producer that could not determine success says so in `meta.okKnown`.
      // Render that as unknown (○), never as a confirmed success (✓). This is
      // producer-agnostic: any adapter may set it. `meta` is excluded from the
      // behavioural signature, so it can never create a divergence.
      if (isOkUnknown(s)) return { mark: 'neutral', text: name };
      return { mark: 'ok', text: name };
    }

    case 'state': {
      const paths = step.changes.map((c) => c.path);
      const shown = paths.slice(0, 2).join(', ');
      const rest = paths.length - Math.min(2, paths.length);
      const verb = step.changes.every((c) => c.op === 'remove')
        ? 'removed'
        : step.changes.every((c) => c.op === 'add')
          ? 'added'
          : 'set';
      return { mark: 'none', text: `${verb} ${shown}${rest > 0 ? ` +${rest}` : ''}` };
    }

    case 'error':
      return { mark: 'fail', text: step.kind ?? 'error', sub: step.message };

    case 'retry': {
      const target = step.ofStep ? toolNameOfStepId(step.ofStep, all) : undefined;
      return {
        mark: 'neutral',
        text: target ? `retry ${target} · attempt ${step.attempt}` : `retry · attempt ${step.attempt}`,
        sub: step.reason,
      };
    }

    case 'stop': {
      const l = STOP_LABEL[step.reason];
      return { mark: l.mark, text: l.text };
    }
  }
}

/** True when the source recorded no success/failure signal for this result. */
export function isOkUnknown(s: NormalizedStep): boolean {
  return s.step.type === 'tool_result' && s.step.meta?.okKnown === false;
}

function nameOfPairedCall(s: NormalizedStep, all: NormalizedStep[]): string | undefined {
  if (s.pairedIndex === undefined) return undefined;
  const call = all[s.pairedIndex]?.step;
  return call?.type === 'tool_call' ? call.name : undefined;
}

function toolNameOfStepId(id: string, all: NormalizedStep[]): string | undefined {
  const found = all.find((x) => x.step.id === id);
  return found?.step.type === 'tool_call' ? found.step.name : undefined;
}

/** Leaf key/value pairs of a tool call's arguments. Content, not selection. */
export function argLines(s: NormalizedStep, max = 6): Array<{ k: string; v: string }> {
  if (s.step.type !== 'tool_call') return [];
  const out: Array<{ k: string; v: string }> = [];
  for (const [path, value] of leafPaths(s.step.args ?? null)) {
    if (path === '$') continue;
    out.push({ k: path, v: fmtValue(value) });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Which single changed field to surface on a compact two-lane row.
 *
 * A fixed per-type prefix priority, in the same category as the stop lexicon:
 * it encodes where in OUR schema a step's payload lives, not which change
 * matters more. Steps whose label already carries the change (stop, error,
 * retry) return nothing rather than repeat themselves.
 */
const SALIENT_PREFIX: Record<string, string[]> = {
  tool_call: ['args.'],
  tool_result: ['result.', 'error.'],
  state: ['changes['],
  model: [],
  error: [],
  retry: [],
  stop: [],
};

export function salientField(row: AlignedRow): FieldDiff | undefined {
  const type = (row.a ?? row.b)?.step.type;
  if (!type || !row.fields?.length) return undefined;
  const prefixes = SALIENT_PREFIX[type] ?? [];
  if (prefixes.length === 0) return undefined;
  for (const p of prefixes) {
    const hit = row.fields.find((f) => f.path.startsWith(p));
    if (hit) return hit;
  }
  return row.fields[0];
}

/** "args.limit" → "limit"; "changes[0].after" → "after". */
export function shortPath(path: string): string {
  const clean = path.replace(/\[\d+\]/g, '');
  const i = clean.lastIndexOf('.');
  return i === -1 ? clean : clean.slice(i + 1);
}

/**
 * The same overlap threshold the inspector already ships for deciding whether
 * two texts were edited or replaced. Reused so the two surfaces never disagree.
 */
export const REPLACED_MAX_OVERLAP = 0.35;

export function isReplacement(a: string, b: string, sameChars: number): boolean {
  return sameChars / Math.max(1, a.length, b.length) < REPLACED_MAX_OVERLAP;
}

/** Title for the inspector and the differences rail. Producer strings verbatim. */
export function subjectOf(row: AlignedRow): string {
  const step = (row.a ?? row.b)?.step;
  if (!step) return 'step';
  if (step.type === 'tool_call') return step.name;
  if (step.type === 'tool_result') return step.name ?? 'result';
  if (step.type === 'state') return 'state';
  if (step.type === 'error') return step.kind ?? 'error';
  if (step.type === 'stop') return 'stop condition';
  if (step.type === 'retry') return 'retry';
  return 'model output';
}

/** "3 arguments changed" — a count of computed field diffs, nothing more. */
export function describeChange(row: AlignedRow): string {
  const step = (row.a ?? row.b)?.step;
  const fields = row.fields ?? [];
  if (!step || fields.length === 0) return 'changed';

  switch (step.type) {
    case 'tool_call': {
      const n = fields.filter((f) => f.path.startsWith('args.')).length || fields.length;
      return `${n} argument${n === 1 ? '' : 's'} changed`;
    }
    case 'model':
      return 'output changed';
    case 'tool_result': {
      const okChanged = fields.some((f) => f.path === 'ok');
      if (okChanged) return 'outcome changed';
      return `${fields.length} field${fields.length === 1 ? '' : 's'} changed`;
    }
    case 'state':
      return `${fields.length} value${fields.length === 1 ? '' : 's'} changed`;
    case 'stop': {
      const r = fields.find((f) => f.path === 'reason');
      return r ? `${String(r.before)} → ${String(r.after)}` : 'stop condition changed';
    }
    default:
      return `${fields.length} field${fields.length === 1 ? '' : 's'} changed`;
  }
}

export interface DivergenceCopy {
  title: string;
  sub: string;
  /** Optional third line stating how much extra each run did. */
  extent?: string;
}

/**
 * The differences rail. One item per divergence region, per the approved design.
 * Every clause is a count, a position, or a producer string.
 */
export function describeDivergence(div: Divergence, replaced?: boolean): DivergenceCopy {
  const head = div.rows[0];
  const soloA = div.rows.filter((r) => r.kind === 'onlyA').length;
  const soloB = div.rows.filter((r) => r.kind === 'onlyB').length;

  const extentParts: string[] = [];
  if (soloA) extentParts.push(`Run A ran ${soloA} extra step${soloA === 1 ? '' : 's'}`);
  if (soloB) extentParts.push(`Run B ran ${soloB} extra step${soloB === 1 ? '' : 's'}`);
  const extent = extentParts.join(' · ') || undefined;

  if (head.kind === 'changed') {
    const step = (head.a ?? head.b)?.step;
    if (step?.type === 'stop') {
      return { title: 'Stop condition', sub: describeChange(head), extent };
    }
    if (step?.type === 'model') {
      return {
        title: 'model output',
        sub: replaced ? 'output replaced' : 'output changed',
        extent,
      };
    }
    return { title: subjectOf(head), sub: describeChange(head), extent };
  }

  // An insertion or deletion opens the region.
  const side = head.kind === 'onlyA' ? 'A' : 'B';
  const run = div.rows.filter((r) => r.kind === head.kind);
  const names = [...new Set(run.map((r) => plainAnchor(r)))].slice(0, 3);
  return {
    title: `Extra steps in Run ${side}`,
    sub: names.join(' · '),
    extent: `${run.length} step${run.length === 1 ? '' : 's'}`,
  };
}

/** Strips internal anchor prefixes so the rail never shows "tool:" or "result:". */
export function plainAnchor(row: AlignedRow): string {
  const s = row.a ?? row.b;
  if (!s) return 'step';
  const step = s.step;
  if (step.type === 'tool_call') return step.name;
  if (step.type === 'tool_result') return step.name ?? 'result';
  if (step.type === 'state') return 'state';
  if (step.type === 'error') return step.kind ?? 'error';
  return step.type === 'model' ? 'model' : step.type;
}
