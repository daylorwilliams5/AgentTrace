import { describe, expect, it } from 'vitest';
import { importTrace } from '../src/core/adapters/registry';
import { normalize } from '../src/core/model/normalize';
import { align } from '../src/core/diff/align';
import { divergences } from '../src/core/diff/divergence';
import { FIXTURE_PAIRS, fixturePair } from '../src/fixtures';
import { shape } from './helpers';
import type { NormalizedTrace } from '../src/core/schema/types';

/**
 * Per-fixture acceptance. Each pair asserts an exact alignment shape, the
 * exact first divergence, and the exact field-level diff at that point.
 *
 * Exact shape strings are deliberate: a regression in the repeated-anchor
 * handling shows up here as a specific character moving, which is diagnosable,
 * rather than as a soft count changing.
 */

function load(key: string): { a: NormalizedTrace; b: NormalizedTrace } {
  const pair = fixturePair(key);
  const ra = importTrace(pair.a);
  const rb = importTrace(pair.b);
  if (!ra.ok) throw new Error(`fixture ${key}.a invalid: ${JSON.stringify(ra.issues)}`);
  if (!rb.ok) throw new Error(`fixture ${key}.b invalid: ${JSON.stringify(rb.issues)}`);
  return { a: normalize(ra.trace), b: normalize(rb.trace) };
}

describe('every fixture imports cleanly', () => {
  it.each(FIXTURE_PAIRS.map((p) => p.key))('%s', (key) => {
    const pair = fixturePair(key);
    for (const [side, raw] of [
      ['a', pair.a],
      ['b', pair.b],
    ] as const) {
      const r = importTrace(raw);
      expect(r.ok, `${key}.${side}: ${JSON.stringify(r.ok ? [] : r.issues)}`).toBe(true);
      if (r.ok) {
        expect(r.adapterId).toBe('native');
        expect(r.warnings).toEqual([]);
      }
    }
  });
});

describe('arg-drift — one wrong tool argument, no re-convergence', () => {
  const { a, b } = load('arg-drift');
  const al = align(a, b);
  const d = divergences(al);

  it('aligns the drifted call to the original call, not to the retry', () => {
    expect(al.rows[1].a?.step.id).toBe('a1');
    expect(al.rows[1].b?.step.id).toBe('b1');
    expect(al.rows[1].kind).toBe('changed');
  });

  it('first divergence is the tool argument at row 1', () => {
    expect(al.firstDivergenceRow).toBe(1);
    // The divergence leads with its first observed differing row, then the extent.
    expect(d[0].summary).toBe(
      'tool:search_invoices · args.id, args.limit, args.query → +4 in B, −3 in A, 4 changed',
    );
  });

  it('names the exact changed fields', () => {
    expect(al.rows[1].fields).toEqual([
      { path: 'args.id', op: 'removed', before: 'INV-2291' },
      { path: 'args.limit', op: 'changed', before: 1, after: 10 },
      { path: 'args.query', op: 'added', after: 'INV-2291' },
    ]);
  });

  it('carries the consequence through to the result', () => {
    const row = al.rows[2];
    expect(row.kind).toBe('changed');
    expect(row.fields?.find((f) => f.path === 'result.hits')).toEqual({
      path: 'result.hits',
      op: 'changed',
      before: 1,
      after: 0,
    });
  });

  it('never re-converges: one divergence running to the end', () => {
    expect(d).toHaveLength(1);
    expect(d[0].startRow).toBe(1);
    expect(d[0].endRow).toBe(al.rows.length - 1);
    expect(al.counts).toEqual({ identical: 1, changed: 4, onlyA: 3, onlyB: 4 });
  });
});

describe('stop-decision — a detour, then identical work, then a different stop', () => {
  const { a, b } = load('stop-decision');
  const al = align(a, b);
  const d = divergences(al);

  it('has the expected shape', () => {
    expect(shape(al)).toBe('===+++=======~');
  });

  it('first divergence is B self-inserting a verification detour', () => {
    expect(al.firstDivergenceRow).toBe(3);
    expect(d[0].kind).toBe('onlyB');
    expect(d[0].rows).toHaveLength(3);
    expect(d[0].summary).toBe('+3 in B · model, tool:list_incidents, result:list_incidents');
  });

  it('the six identical read_incident rows are foldable between divergences', () => {
    const between = al.rows.slice(d[0].endRow + 1, d[1].startRow);
    expect(between).toHaveLength(7);
    expect(between.every((r) => r.kind === 'identical')).toBe(true);
  });

  it('second divergence is the stop decision alone', () => {
    expect(d).toHaveLength(2);
    expect(d[1].kind).toBe('changed');
    expect(d[1].rows).toHaveLength(1);
    const fields = d[1].rows[0].fields ?? [];
    expect(fields.find((f) => f.path === 'reason')).toEqual({
      path: 'reason',
      op: 'changed',
      before: 'goal_met',
      after: 'max_steps',
    });
  });

  it('pairs A\'s single list_incidents with B\'s first, not B\'s verification call', () => {
    expect(al.rows[1].a?.step.id).toBe('a1');
    expect(al.rows[1].b?.step.id).toBe('b1');
    expect(al.rows[1].kind).toBe('identical');
  });
});

describe('failure-recovery — three fetch attempts vs two', () => {
  const { a, b } = load('failure-recovery');
  const al = align(a, b);
  const d = divergences(al);

  it('the shared failure prefix is identical', () => {
    expect(al.rows.slice(0, 7).every((r) => r.kind === 'identical')).toBe(true);
    expect(al.firstDivergenceRow).toBe(7);
  });

  it('pairs the first two fetch attempts and marks the third as B-only', () => {
    const fetchRows = al.rows.filter((r) => (r.a ?? r.b)?.anchor === 'tool:fetch_page');
    expect(fetchRows.map((r) => r.kind)).toEqual(['identical', 'identical', 'onlyB']);
    expect(fetchRows[2].b?.step.id).toBe('b9');
  });

  it('divergence begins at the model step where the strategies split', () => {
    expect(al.rows[7].kind).toBe('changed');
    expect(al.rows[7].a?.step.id).toBe('a7');
    expect(al.rows[7].b?.step.id).toBe('b7');
    const fields = al.rows[7].fields ?? [];
    expect(fields.map((f) => f.path)).toEqual(['output']);
  });

  it('one divergence, running to the end', () => {
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe('structural');
    expect(al.counts).toEqual({ identical: 7, changed: 2, onlyA: 5, onlyB: 4 });
  });
});

describe('inconclusive-retrieval — both runs report success', () => {
  const { a, b } = load('inconclusive-retrieval');
  const al = align(a, b);
  const d = divergences(al);

  it('has the expected shape', () => {
    expect(shape(al)).toBe('===~--~~~~=');
  });

  it('the ambiguous search and its 3-hit result are identical in both runs', () => {
    expect(al.rows.slice(0, 3).every((r) => r.kind === 'identical')).toBe(true);
  });

  it('first divergence is how the model handled the ambiguity', () => {
    expect(al.firstDivergenceRow).toBe(3);
    expect(al.rows[3].a?.step.type).toBe('model');
    expect(al.rows[3].fields?.map((f) => f.path)).toEqual(['output']);
  });

  it('surfaces the wrong customer id that follows from it', () => {
    const stateRow = al.rows.find((r) => (r.a ?? r.b)?.anchor === 'state:customer');
    expect(stateRow?.kind).toBe('changed');
    expect(stateRow?.fields).toEqual([
      { path: 'changes[0].after', op: 'changed', before: 'C-2277', after: 'C-1041' },
    ]);
  });

  it('the stop step is IDENTICAL — both runs claim goal_met', () => {
    const last = al.rows[al.rows.length - 1];
    expect(last.kind).toBe('identical');
    expect(last.a?.step.type).toBe('stop');
    expect(a.trace.status).toBe('success');
    expect(b.trace.status).toBe('success');
  });

  it('one divergence, ending before the stop', () => {
    expect(d).toHaveLength(1);
    expect(d[0].startRow).toBe(3);
    expect(d[0].endRow).toBe(9);
  });
});

describe('determinism across all fixtures', () => {
  it.each(FIXTURE_PAIRS.map((p) => p.key))('%s is stable over 20 runs', (key) => {
    const { a, b } = load(key);
    const shapes = Array.from({ length: 20 }, () => shape(align(a, b)));
    expect(new Set(shapes).size).toBe(1);
  });
});
