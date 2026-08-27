import { anchorOf } from '../diff/anchor';
import { signatureOf } from '../diff/signature';
import {
  toolStatusOf,
} from '../schema/types';
import type {
  NormalizedStep,
  NormalizedTrace,
  Step,
  StepType,
  Trace,
} from '../schema/types';
import { STEP_TYPES } from '../schema/types';

/**
 * Derive everything the UI and the diff need, once, without mutating the
 * source trace. All of it is a pure function of the trace, so it can be
 * memoized on trace identity.
 */
export function normalize(trace: Trace): NormalizedTrace {
  const start = toMs(trace.startedAt) ?? firstTimestamp(trace.steps);

  // Pass 1 — resolve callId → tool name and call/result pairing.
  const callIndexById = new Map<string, number>();
  const resultIndexByCallId = new Map<string, number>();
  trace.steps.forEach((s, i) => {
    if (s.type === 'tool_call') callIndexById.set(s.callId, i);
    else if (s.type === 'tool_result' && !resultIndexByCallId.has(s.callId)) {
      resultIndexByCallId.set(s.callId, i);
    }
  });

  const byId = new Map(trace.steps.map((s, i) => [s.id, i] as const));

  // Pass 2 — anchors and per-anchor ordinals.
  const anchorCounts = new Map<string, number>();
  const steps: NormalizedStep[] = trace.steps.map((step, index) => {
    let resolvedName: string | undefined;
    let pairedIndex: number | undefined;
    let callArgs: unknown;
    let resultStatus: import('../schema/types').ToolStatus | undefined;

    if (step.type === 'tool_result') {
      const ci = callIndexById.get(step.callId);
      if (ci !== undefined) {
        const call = trace.steps[ci];
        if (call.type === 'tool_call') {
          resolvedName = call.name;
          callArgs = call.args;
        }
        pairedIndex = ci;
      }
    } else if (step.type === 'tool_call') {
      const ri = resultIndexByCallId.get(step.callId);
      if (ri !== undefined) {
        const res = trace.steps[ri];
        if (res.type === 'tool_result') resultStatus = toolStatusOf(res);
        pairedIndex = ri;
      }
    }

    const anchor = anchorOf(step, resolvedName);
    const ordinal = anchorCounts.get(anchor) ?? 0;
    anchorCounts.set(anchor, ordinal + 1);

    // A model turn's observable evidence when it produced no visible output.
    const emittedTools = step.type === 'model' ? emittedToolAnchors(trace.steps, index) : undefined;

    const ts = toMs(step.t);
    return {
      step,
      index,
      anchor,
      signature: signatureOf(step, emittedTools ? { emittedTools } : undefined),
      ordinal,
      depth: depthOf(step, trace.steps, byId),
      offsetMs: ts !== undefined && start !== undefined ? ts - start : undefined,
      label: step.label ?? deriveLabel(step, resolvedName),
      pairedIndex,
      callArgs,
      resultStatus,
      emittedTools,
    };
  });

  return { trace, steps, stats: statsOf(trace, steps, start) };
}

// ---------------------------------------------------------------------------

/**
 * Anchors of the maximal run of tool_call steps immediately following `i`.
 *
 * Positional, because agenttrace/v1 has no back-reference from a model step to
 * the calls it produced: a turn's calls are emitted directly after it. Total
 * work is linear across the trace — each tool_call is scanned by at most the one
 * model step that precedes its run.
 */
function emittedToolAnchors(steps: Step[], i: number): string[] {
  const out: string[] = [];
  for (let j = i + 1; j < steps.length && steps[j].type === 'tool_call'; j++) {
    out.push(anchorOf(steps[j]));
  }
  return out;
}

function depthOf(step: Step, all: Step[], byId: Map<string, number>): number {
  let depth = 0;
  let cur: Step = step;
  // Seeded with the step's own id so a self-parent is a cycle, not a level.
  const seen = new Set<string>([step.id]);
  while (cur.parent) {
    if (seen.has(cur.parent)) break;
    const pi = byId.get(cur.parent);
    if (pi === undefined) break;
    seen.add(cur.parent);
    depth++;
    cur = all[pi];
    if (depth > 16) break; // V1 does not render deep nesting anyway
  }
  return depth;
}

/** Row summaries when the producer supplies none. Presentational only. */
function deriveLabel(step: Step, resolvedName?: string): string {
  switch (step.type) {
    case 'model':
      return firstLine(step.output) || '(empty output)';
    case 'tool_call':
      return step.name;
    case 'tool_result': {
      const name = step.name ?? resolvedName ?? 'result';
      const st = toolStatusOf(step);
      if (st === 'failure') return `${name} failed${step.error?.kind ? ` — ${step.error.kind}` : ''}`;
      if (st === 'unknown') return `${name} — status not reported`;
      return name;
    }
    case 'state':
      return step.changes.map((c) => c.path).slice(0, 3).join(', ') +
        (step.changes.length > 3 ? ` +${step.changes.length - 3}` : '');
    case 'error':
      return firstLine(step.message);
    case 'retry':
      return `attempt ${step.attempt}${step.reason ? ` — ${step.reason}` : ''}`;
    case 'stop':
      return step.reason;
  }
}

function firstLine(s: string): string {
  const line = s.split('\n', 1)[0].trim();
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

export function toMs(t: number | string | undefined): number | undefined {
  if (t === undefined) return undefined;
  if (typeof t === 'number') return Number.isFinite(t) ? t : undefined;
  const parsed = Date.parse(t);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function firstTimestamp(steps: Step[]): number | undefined {
  for (const s of steps) {
    const ms = toMs(s.t);
    if (ms !== undefined) return ms;
  }
  return undefined;
}

function statsOf(trace: Trace, steps: NormalizedStep[], start?: number) {
  const byType = Object.fromEntries(STEP_TYPES.map((t) => [t, 0])) as Record<StepType, number>;
  for (const s of steps) byType[s.step.type]++;

  let end = toMs(trace.endedAt);
  if (end === undefined) {
    for (let i = steps.length - 1; i >= 0; i--) {
      const ms = toMs(steps[i].step.t);
      if (ms !== undefined) {
        end = ms + (steps[i].step.dur ?? 0);
        break;
      }
    }
  }

  return {
    total: steps.length,
    byType,
    tools: byType.tool_call,
    // Only CONFIRMED failures count. `unknown` is not a failure.
    errors:
      byType.error +
      steps.filter((s) => s.step.type === 'tool_result' && toolStatusOf(s.step) === 'failure').length,
    retries: byType.retry,
    wallMs: start !== undefined && end !== undefined ? end - start : undefined,
  };
}
