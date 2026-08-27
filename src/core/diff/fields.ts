import type { Step } from '../schema/types';
import { canonicalJson, leafPaths } from '../util/json';
import { semanticFieldsOf } from './signature';

export type FieldOp = 'added' | 'removed' | 'changed';

export interface FieldDiff {
  /** Leaf path within the step's semantic fields, e.g. "args.limit". */
  path: string;
  op: FieldOp;
  before?: unknown;
  after?: unknown;
}

/**
 * Mechanical field-level diff between two aligned steps. Operates on the same
 * semantic subset the signature uses, so a `changed` row is always explained
 * by at least one entry here — the classification and the explanation can
 * never disagree.
 */
export function fieldDiff(a: Step, b: Step): FieldDiff[] {
  const pa = leafPaths(semanticFieldsOf(a));
  const pb = leafPaths(semanticFieldsOf(b));

  const paths = [...new Set([...pa.keys(), ...pb.keys()])].sort();
  const out: FieldDiff[] = [];

  for (const path of paths) {
    if (path === 'type') continue;
    const inA = pa.has(path);
    const inB = pb.has(path);
    const va = pa.get(path);
    const vb = pb.get(path);

    if (inA && !inB) out.push({ path, op: 'removed', before: va });
    else if (!inA && inB) out.push({ path, op: 'added', after: vb });
    else if (canonicalJson(va) !== canonicalJson(vb)) {
      out.push({ path, op: 'changed', before: va, after: vb });
    }
  }

  return out;
}

/**
 * Non-behavioural differences, surfaced separately in the inspector.
 *
 * `analysis` is optional, provider-supplied, and excluded from the signature,
 * so it never decides `identical` vs `changed` and never creates a divergence.
 * But once the user has a paired step open, a difference in it is worth
 * showing — clearly subordinate to the observable execution, and clearly
 * labelled as not part of the behavioural comparison.
 */
export function auxiliaryDiff(a: Step, b: Step): FieldDiff[] {
  if (a.type !== 'model' || b.type !== 'model') return [];
  if (a.analysis === undefined && b.analysis === undefined) return [];
  if (a.analysis === b.analysis) return [];
  if (a.analysis === undefined) return [{ path: 'analysis', op: 'added', after: b.analysis }];
  if (b.analysis === undefined) return [{ path: 'analysis', op: 'removed', before: a.analysis }];
  return [{ path: 'analysis', op: 'changed', before: a.analysis, after: b.analysis }];
}

/** Compact, deterministic characterization of a field diff. No prose. */
export function summarizeFields(diffs: FieldDiff[], max = 4): string {
  if (diffs.length === 0) return '';
  const shown = diffs.slice(0, max).map((d) => d.path);
  const rest = diffs.length - shown.length;
  return shown.join(', ') + (rest > 0 ? ` +${rest}` : '');
}
