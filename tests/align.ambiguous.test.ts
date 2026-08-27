import { describe, expect, it } from 'vitest';
import { align, PREFERS_PAIRING } from '../src/core/diff/align';
import { contextSimilarity, ordinalSimilarity } from '../src/core/diff/similarity';
import { divergences } from '../src/core/diff/divergence';
import { C, M, R, RETRY, STOP, T, matchedIndices, shape } from './helpers';

/**
 * The repeated-anchor acceptance suite. Each case has an unambiguous correct
 * answer that plain LCS over anchors does not reliably produce.
 *
 * See docs/alignment.md §7.
 */

describe('invariants', () => {
  it('always prefers pairing anchor-equal steps over splitting them', () => {
    // worst match (M_BASE) must beat delete + insert (2 * GAP)
    expect(PREFERS_PAIRING).toBe(true);
  });

  it('reports changed arguments as CHANGED, never as DELETE + INSERT', () => {
    const a = T('a', [C('search', { id: 'INV-1' }, 'c1')]);
    const b = T('b', [C('search', { query: 'INV-1', limit: 10 }, 'k1')]);
    const al = align(a, b);
    expect(shape(al)).toBe('~');
    expect(al.rows[0].fields?.map((f) => f.path).sort()).toEqual([
      'args.id',
      'args.limit',
      'args.query',
    ]);
  });
});

describe('case 1 — extra occurrence in the middle of a repeated run', () => {
  const a = T('a', [
    C('search', { q: 'alpha' }, 'c1'),
    C('search', { q: 'beta' }, 'c2'),
    C('search', { q: 'gamma' }, 'c3'),
    C('read', { id: 7 }, 'c4'),
  ]);
  const b = T('b', [
    C('search', { q: 'alpha' }, 'k1'),
    C('search', { q: 'gamma' }, 'k2'),
    C('read', { id: 7 }, 'k3'),
  ]);

  it('drops the middle occurrence, not a positional one', () => {
    const al = align(a, b);
    expect(shape(al)).toBe('=-==');
    expect(matchedIndices(al)).toEqual([
      [0, 0],
      [2, 1],
      [3, 2],
    ]);
  });

  it('produces exactly one divergence, of one row', () => {
    const d = divergences(align(a, b));
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe('onlyA');
    expect(d[0].startRow).toBe(1);
    expect(d[0].endRow).toBe(1);
  });
});

describe('case 2 — retry burst; the correct call is the second one', () => {
  const a = T('a', [
    M('Looking up the invoice.'),
    C('search', { id: 'INV-1' }, 'c1'),
    R('c1', true, { hits: 1 }),
  ]);
  const b = T('b', [
    M('Looking up the invoice.'),
    C('search', { q: 'INV-1' }, 'k1'),
    R('k1', true, { hits: 0 }),
    RETRY(1, { reason: 'empty_result_set' }),
    C('search', { id: 'INV-1' }, 'k2'),
    R('k2', true, { hits: 1 }),
  ]);

  it("argument evidence beats positional adjacency", () => {
    const al = align(a, b);
    // A's single search pairs with B's SECOND search (index 4), not B's first.
    expect(matchedIndices(al)).toEqual([
      [0, 0],
      [1, 4],
      [2, 5],
    ]);
    expect(shape(al)).toBe('=+++==');
  });

  it('the paired steps are identical, so the divergence is purely structural', () => {
    const al = align(a, b);
    expect(al.counts).toEqual({ identical: 3, changed: 0, onlyA: 0, onlyB: 3 });
    const d = divergences(al);
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe('onlyB');
    expect(d[0].rows).toHaveLength(3);
  });
});

describe('case 3 — indistinguishable repeats', () => {
  const mk = (n: number, id: string) =>
    T(id, [
      ...Array.from({ length: n }, (_, i) => C('search', { q: 'x' }, `${id}c${i}`)),
      STOP('goal_met'),
    ]);

  it('drops the INTERIOR occurrence; boundaries pair with boundaries', () => {
    const al = align(mk(3, 'a'), mk(2, 'b'));
    expect(shape(al)).toBe('=-==');
    expect(matchedIndices(al)).toEqual([
      [0, 0],
      [2, 1],
      [3, 2],
    ]);
  });

  it('is deterministic across repeated runs', () => {
    const a = mk(3, 'a');
    const b = mk(2, 'b');
    const results = Array.from({ length: 25 }, () => shape(align(a, b)));
    expect(new Set(results).size).toBe(1);
  });

  it('ordinal proximity is the last-resort tie-break', () => {
    expect(ordinalSimilarity(0, 0)).toBe(1);
    expect(ordinalSimilarity(0, 1)).toBe(0.5);
    expect(ordinalSimilarity(0, 2)).toBeCloseTo(1 / 3);
  });
});

describe('case 4 — indistinguishable results must follow their calls', () => {
  const a = T('a', [C('search', { id: 'X' }, 'c1'), R('c1', true, { status: 'ok' })]);
  const b = T('b', [
    C('search', { q: 'X' }, 'k1'),
    R('k1', true, { status: 'ok' }),
    C('search', { id: 'X' }, 'k2'),
    R('k2', true, { status: 'ok' }),
  ]);

  it('pairs via callSim even though both results are byte-identical', () => {
    const al = align(a, b);
    expect(matchedIndices(al)).toEqual([
      [0, 2],
      [1, 3],
    ]);
    expect(shape(al)).toBe('++==');
  });
});

describe('case 5 — no false pairing across tools', () => {
  it('never aligns different tool names', () => {
    const a = T('a', [C('search', { q: 'x' }, 'c1')]);
    const b = T('b', [C('fetch', { u: 'x' }, 'k1')]);
    const al = align(a, b);
    expect(shape(al)).toBe('-+');
    expect(al.counts.changed).toBe(0);
  });

  it('never aligns different step types', () => {
    const a = T('a', [M('hello')]);
    const b = T('b', [STOP('goal_met')]);
    expect(shape(align(a, b))).toBe('-+');
  });
});

describe('context similarity (unit)', () => {
  const a = T('a', [C('search', {}, 'c1'), C('fetch', {}, 'c2'), C('parse', {}, 'c3')]);
  const b = T('b', [C('search', {}, 'k1'), C('fetch', {}, 'k2'), C('parse', {}, 'k3')]);

  it('counts both-out-of-bounds as agreement', () => {
    expect(contextSimilarity(0, 0, a.steps, b.steps)).toBe(1);
    expect(contextSimilarity(2, 2, a.steps, b.steps)).toBe(1);
  });

  it('counts one-sided out-of-bounds as disagreement', () => {
    const longer = T('c', [
      C('pre', {}, 'p0'),
      C('search', {}, 'p1'),
      C('fetch', {}, 'p2'),
      C('parse', {}, 'p3'),
    ]);
    // a[0] has no left neighbour; longer[1] does → left term is 0, right term 1.
    expect(contextSimilarity(0, 1, a.steps, longer.steps)).toBe(0.5);
  });
});

describe('known limitation — transposition is not detected', () => {
  it('reports a reorder as unpaired steps, by design (pinned)', () => {
    const a = T('a', [C('search', { q: 'x' }, 'c1'), C('fetch', { u: 'y' }, 'c2')]);
    const b = T('b', [C('fetch', { u: 'y' }, 'k1'), C('search', { q: 'x' }, 'k2')]);
    const al = align(a, b);
    // Global alignment is order-preserving: exactly one of the two can pair.
    expect(al.counts.identical).toBe(1);
    expect(al.counts.onlyA).toBe(1);
    expect(al.counts.onlyB).toBe(1);
  });
});

describe('degenerate inputs', () => {
  it('handles two empty traces', () => {
    const al = align(T('a', []), T('b', []));
    expect(al.rows).toEqual([]);
    expect(al.firstDivergenceRow).toBe(-1);
  });

  it('handles one empty trace', () => {
    const al = align(T('a', []), T('b', [M('x'), STOP('goal_met')]));
    expect(shape(al)).toBe('++');
  });

  it('is structurally symmetric under swapping the operands', () => {
    const a = T('a', [M('x'), C('search', { q: 1 }, 'c1'), STOP('goal_met')]);
    const b = T('b', [M('x'), C('search', { q: 1 }, 'k1'), C('search', { q: 2 }, 'k2'), STOP('user')]);
    const ab = align(a, b);
    const ba = align(b, a);
    expect(ab.counts.onlyA).toBe(ba.counts.onlyB);
    expect(ab.counts.onlyB).toBe(ba.counts.onlyA);
    expect(ab.counts.identical).toBe(ba.counts.identical);
    expect(ab.counts.changed).toBe(ba.counts.changed);
  });

  it('takes the fast path when anchor sequences match exactly', () => {
    const a = T('a', [M('x'), C('search', { q: 1 }, 'c1')]);
    const b = T('b', [M('y'), C('search', { q: 2 }, 'k1')]);
    const al = align(a, b);
    expect(al.fastPath).toBe(true);
    expect(shape(al)).toBe('~~');
  });
});
