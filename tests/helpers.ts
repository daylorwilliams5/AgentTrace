import { normalize } from '../src/core/model/normalize';
import {
  SCHEMA_ID,
  type ErrorStep,
  type ModelStep,
  type NormalizedTrace,
  type RetryStep,
  type StateStep,
  type Step,
  type StopStep,
  type ToolCallStep,
  type ToolResultStep,
} from '../src/core/schema/types';
import type { AlignedRow, Alignment } from '../src/core/diff/align';

/** Compact builders for hand-written alignment cases. Ids are positional. */

let seq = 0;
const uid = (p: string) => `${p}${seq++}`;

export function T(id: string, steps: Step[]): NormalizedTrace {
  return normalize({ schema: SCHEMA_ID, id, steps });
}

export const M = (output: string, extra: Partial<ModelStep> = {}): ModelStep => ({
  id: uid('m'),
  type: 'model',
  output,
  ...extra,
});

export const C = (
  name: string,
  args: unknown,
  callId = uid('c'),
  extra: Partial<ToolCallStep> = {},
): ToolCallStep => ({ id: uid('tc'), type: 'tool_call', callId, name, args, ...extra });

export const R = (
  callId: string,
  ok: boolean,
  result?: unknown,
  extra: Partial<ToolResultStep> = {},
): ToolResultStep => ({ id: uid('tr'), type: 'tool_result', callId, ok, result, ...extra });

export const RETRY = (attempt: number, extra: Partial<RetryStep> = {}): RetryStep => ({
  id: uid('rt'),
  type: 'retry',
  attempt,
  ...extra,
});

export const ERR = (message: string, kind?: string): ErrorStep => ({
  id: uid('er'),
  type: 'error',
  message,
  kind,
});

export const STOP = (reason: StopStep['reason'], detail?: string): StopStep => ({
  id: uid('st'),
  type: 'stop',
  reason,
  detail,
});

export const ST = (path: string, after: unknown): StateStep => ({
  id: uid('sc'),
  type: 'state',
  changes: [{ path, after, op: 'set' }],
});

/**
 * Compact rendering of an alignment for assertions and for the report script.
 * `=` identical · `~` changed · `-` only in A · `+` only in B
 */
export const GLYPH = { identical: '=', changed: '~', onlyA: '-', onlyB: '+' } as const;

export function shape(alignment: Alignment): string {
  return alignment.rows.map((r) => GLYPH[r.kind]).join('');
}

/** Row → "a-index:b-index" using the ORIGINAL step ids, for pairing assertions. */
export function pairing(alignment: Alignment): string[] {
  return alignment.rows.map(rowLabel);
}

export function rowLabel(r: AlignedRow): string {
  const a = r.a ? `${r.a.step.id}` : '·';
  const b = r.b ? `${r.b.step.id}` : '·';
  return `${GLYPH[r.kind]} ${a}/${b}`;
}

/** Indices (within their own trace) of the steps paired on each matched row. */
export function matchedIndices(alignment: Alignment): Array<[number, number]> {
  return alignment.rows
    .filter((r) => r.a && r.b)
    .map((r) => [r.a!.index, r.b!.index] as [number, number]);
}
