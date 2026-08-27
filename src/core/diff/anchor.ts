import type { Step } from '../schema/types';

/**
 * The coarse alignment key. Two steps may be paired if and only if their
 * anchors are equal — this is a hard constraint, not a preference.
 *
 * Anchors deliberately exclude arguments and content. That is the whole point:
 * `search(id=…)` and `search(query=…)` must align so the difference shows up as
 * CHANGED rather than as DELETE + INSERT.
 *
 * See docs/alignment.md §3.
 */
export function anchorOf(step: Step, resolvedToolName?: string): string {
  switch (step.type) {
    case 'model':
      return 'model';
    case 'tool_call':
      return `tool:${step.name}`;
    case 'tool_result':
      return `result:${step.name ?? resolvedToolName ?? '*'}`;
    case 'state': {
      const roots = [...new Set(step.changes.map((c) => rootOf(c.path)))].sort();
      return `state:${roots.join(',')}`;
    }
    case 'error':
      return `error:${step.kind ?? '*'}`;
    case 'retry':
      return 'retry';
    case 'stop':
      return 'stop';
  }
}

/** First path segment: "plan.steps[2].status" → "plan". */
export function rootOf(path: string): string {
  const m = /^[^.[]+/.exec(path);
  return m ? m[0] : path;
}
