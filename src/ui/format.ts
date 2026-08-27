import { toolStatusOf, type Step, type StepType } from '../core/schema/types';

export const TYPE_LABEL: Record<StepType, string> = {
  model: 'model',
  tool_call: 'tool',
  tool_result: 'result',
  state: 'state',
  error: 'error',
  retry: 'retry',
  stop: 'stop',
};

export function typeColor(type: StepType): string {
  return `var(--t-${type})`;
}

/** Durations are read at a glance, so keep the unit adjacent and the width tight. */
export function fmtDur(ms: number | undefined): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Offsets from run start are what people reason about; absolutes are not. */
export function fmtOffset(ms: number | undefined): string {
  if (ms === undefined) return '—';
  return `+${(ms / 1000).toFixed(2)}s`;
}

export function fmtValue(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v === undefined) return '—';
  return JSON.stringify(v);
}

/**
 * Field-diff rows are scanned, not read. Long values are truncated here; the
 * full text is one tab away (A / B / raw) and, for model output, in the
 * dedicated output section below the diff.
 */
export function fmtValueShort(v: unknown, max = 64): string {
  const full = fmtValue(v);
  return full.length > max ? `${full.slice(0, max - 1)}…` : full;
}

export function prettyJson(v: unknown): string {
  return JSON.stringify(v ?? null, null, 2);
}

/** A failed tool_result reads as a failure in the row, not just in the payload. */
export function isFailure(step: Step): boolean {
  if (step.type === 'tool_result') return toolStatusOf(step) === 'failure';
  return step.type === 'error';
}

export function matchesQuery(step: Step, label: string, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (label.toLowerCase().includes(needle)) return true;
  if (step.type.includes(needle)) return true;
  return JSON.stringify(step).toLowerCase().includes(needle);
}
