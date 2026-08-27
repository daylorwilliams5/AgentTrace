import { toolStatusOf, type Step } from '../schema/types';
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
 * A model step with NO visible output is a special case. agenttrace/v1 splits a
 * model turn from the tool calls it produced, so a turn that emitted only a
 * `tool_use` leaves an empty husk: `{output: "", stopReason: "tool_use"}`. Every
 * such husk hashes identically, which made two turns "behaviourally identical"
 * when one fired eight parallel greps and the other ran one shell command.
 *
 * The rule is that a signature may never be built from no evidence. When a
 * model step has no visible output, its observable evidence is the set of tools
 * it decided to call, so the ordered anchors of the immediately-following
 * tool_call run are folded in. This restores exactly what the schema split
 * apart — no similarity, no thresholds, no interpretation.
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
/**
 * Local execution context for a signature. Supplied by `normalize`, which is
 * the only production caller — it is the only place that can see a step's
 * neighbours. Calling `signatureOf` without context is still valid and yields
 * today's behaviour for every step type.
 */
export interface SignatureContext {
  /** Anchors of the tool_call run immediately following a model step, in order. */
  emittedTools?: string[];
}

export function signatureOf(step: Step, ctx?: SignatureContext): string {
  return hash32(canonicalJson(semanticFieldsOf(step, ctx)));
}

/** The subset of a step that participates in identity. Also used by fields.ts. */
export function semanticFieldsOf(step: Step, ctx?: SignatureContext): Record<string, unknown> {
  switch (step.type) {
    case 'model': {
      const fields: Record<string, unknown> = {
        type: 'model',
        output: step.output,
        stopReason: step.stopReason,
      };
      // Only when there is nothing else to sign on. A turn with visible output
      // keeps exactly today's signature, and a genuinely contentless turn that
      // emitted no tools keeps it too — we do not invent context that the
      // producer never recorded.
      if (!step.output.trim() && ctx?.emittedTools?.length) {
        fields.emitted = ctx.emittedTools;
      }
      return fields;
    }
    case 'tool_call':
      return { type: 'tool_call', name: step.name, args: step.args ?? null };
    case 'tool_result':
      return {
        type: 'tool_result',
        name: step.name,
        // Canonical tri-state, never the raw `ok`: a legacy trace and a
        // migrated one describing the same run must hash identically.
        status: toolStatusOf(step),
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
