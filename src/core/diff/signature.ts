import type { Step } from '../schema/types';
import { canonicalJson, hash32 } from '../util/json';

/**
 * The fine content key. Computed per step; two aligned steps with equal
 * signatures are `identical`, otherwise `changed`.
 *
 * EXCLUDED from every signature, deliberately:
 *
 *   id, callId, ofStep, parent  — opaque per-run identifiers. A run is not
 *                                 behaviourally different because it named a
 *                                 call "c7" instead of "c2".
 *   t, dur, backoffMs           — timing. A slower run is not a different run.
 *                                 Durations are shown in the inspector; they
 *                                 never manufacture a divergence.
 *   tokens                      — accounting, not behaviour.
 *   label, tags, meta           — presentation and passthrough.
 *   attempt (except on `retry`) — noisy bookkeeping; the retry step itself
 *                                 carries the semantically meaningful count.
 *
 * `analysis` is excluded outright. A difference in optional, provider-supplied
 * analysis text must not manufacture a behavioural divergence when the
 * externally observable trajectory is otherwise identical. It remains
 * inspectable and mechanically diffable on an already-paired step — see
 * `auxiliaryDiff` in fields.ts — but it never decides whether two steps are
 * behaviourally identical, and it can never create a divergence by itself.
 *
 * What the behavioural signature is built from, and nothing else:
 * model-visible output · tool selection · tool arguments · tool results ·
 * state changes · errors · retries · stopping behaviour.
 */
export function signatureOf(step: Step): string {
  return hash32(canonicalJson(semanticFieldsOf(step)));
}

/** The subset of a step that participates in identity. Also used by fields.ts. */
export function semanticFieldsOf(step: Step): Record<string, unknown> {
  switch (step.type) {
    case 'model':
      return { type: 'model', output: step.output, stopReason: step.stopReason };
    case 'tool_call':
      return { type: 'tool_call', name: step.name, args: step.args ?? null };
    case 'tool_result':
      return {
        type: 'tool_result',
        name: step.name,
        ok: step.ok,
        result: step.result ?? null,
        error: step.error ? { kind: step.error.kind, message: step.error.message } : null,
      };
    case 'state':
      return {
        type: 'state',
        changes: [...step.changes]
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
          .map((c) => ({ path: c.path, before: c.before ?? null, after: c.after ?? null, op: c.op })),
      };
    case 'error':
      return {
        type: 'error',
        kind: step.kind,
        message: step.message,
        recoverable: step.recoverable,
      };
    case 'retry':
      return { type: 'retry', attempt: step.attempt, reason: step.reason };
    case 'stop':
      return { type: 'stop', reason: step.reason, detail: step.detail };
  }
}
