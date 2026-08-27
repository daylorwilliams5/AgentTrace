import { describe, expect, it } from 'vitest';
import { auxiliaryDiff, fieldDiff } from '../src/core/diff/fields';
import { signatureOf } from '../src/core/diff/signature';
import { wordDiff, tokenizeWords } from '../src/core/diff/words';
import type { ModelStep, Step } from '../src/core/schema/types';
import { align } from '../src/core/diff/align';
import { divergences } from '../src/core/diff/divergence';
import { T } from './helpers';

describe('field diff', () => {
  it('classifies added, removed, and changed leaves', () => {
    const a: Step = { id: 'a', type: 'tool_call', callId: 'c', name: 'f', args: { keep: 1, drop: 2, mut: 3 } };
    const b: Step = { id: 'b', type: 'tool_call', callId: 'k', name: 'f', args: { keep: 1, mut: 4, add: 5 } };
    expect(fieldDiff(a, b)).toEqual([
      { path: 'args.add', op: 'added', after: 5 },
      { path: 'args.drop', op: 'removed', before: 2 },
      { path: 'args.mut', op: 'changed', before: 3, after: 4 },
    ]);
  });

  it('descends into nested results', () => {
    const a: Step = { id: 'a', type: 'tool_result', callId: 'c', status: 'success', result: { rows: [{ id: 1 }] } };
    const b: Step = { id: 'b', type: 'tool_result', callId: 'k', status: 'success', result: { rows: [{ id: 2 }] } };
    expect(fieldDiff(a, b)).toEqual([
      { path: 'result.rows[0].id', op: 'changed', before: 1, after: 2 },
    ]);
  });

  it('never reports a diff for steps with equal signatures', () => {
    const a: Step = { id: 'a', type: 'model', output: 'same', t: 1, dur: 10 };
    const b: Step = { id: 'b', type: 'model', output: 'same', t: 999, dur: 9000 };
    expect(signatureOf(a)).toBe(signatureOf(b));
    expect(fieldDiff(a, b)).toEqual([]);
  });

  it('always reports at least one diff when signatures differ', () => {
    const a: Step = { id: 'a', type: 'stop', reason: 'goal_met' };
    const b: Step = { id: 'b', type: 'stop', reason: 'max_steps' };
    expect(signatureOf(a)).not.toBe(signatureOf(b));
    expect(fieldDiff(a, b).length).toBeGreaterThan(0);
  });
});

describe('auxiliary `analysis` text is never behavioural', () => {
  const withAnalysis: ModelStep = { id: 'a', type: 'model', output: 'go', analysis: 'thought one' };
  const withOther: ModelStep = { id: 'b', type: 'model', output: 'go', analysis: 'thought two' };
  const without: ModelStep = { id: 'c', type: 'model', output: 'go' };

  it('never affects the behavioural signature', () => {
    expect(signatureOf(withAnalysis)).toBe(signatureOf(without));
    expect(signatureOf(withAnalysis)).toBe(signatureOf(withOther));
  });

  it('never appears in the behavioural field diff', () => {
    expect(fieldDiff(withAnalysis, withOther)).toEqual([]);
    expect(fieldDiff(withAnalysis, without)).toEqual([]);
  });

  it('cannot create a divergence by itself', () => {
    const a = T('a', [withAnalysis]);
    const b = T('b', [withOther]);
    const al = align(a, b);
    expect(al.counts.identical).toBe(1);
    expect(al.firstDivergenceRow).toBe(-1);
    expect(divergences(al)).toEqual([]);
  });

  it('is still mechanically diffable on an already-paired step', () => {
    expect(auxiliaryDiff(withAnalysis, withOther)).toEqual([
      { path: 'analysis', op: 'changed', before: 'thought one', after: 'thought two' },
    ]);
    expect(auxiliaryDiff(withAnalysis, without)).toEqual([
      { path: 'analysis', op: 'removed', before: 'thought one' },
    ]);
    expect(auxiliaryDiff(without, withOther)).toEqual([
      { path: 'analysis', op: 'added', after: 'thought two' },
    ]);
    expect(auxiliaryDiff(without, without)).toEqual([]);
  });
});

describe('word diff', () => {
  it('is lossless — spans reconstruct both inputs', () => {
    const a = 'the origin is down, falling back to cache';
    const b = 'the origin is down, retrying the fetch';
    const spans = wordDiff(a, b);
    const left = spans.filter((s) => s.op !== 'added').map((s) => s.text).join('');
    const right = spans.filter((s) => s.op !== 'removed').map((s) => s.text).join('');
    expect(left).toBe(a);
    expect(right).toBe(b);
  });

  it('preserves whitespace as its own tokens', () => {
    expect(tokenizeWords('a  b\nc')).toEqual(['a', '  ', 'b', '\n', 'c']);
  });

  it('marks identical text as entirely unchanged', () => {
    expect(wordDiff('same text', 'same text')).toEqual([{ op: 'same', text: 'same text' }]);
  });
});
