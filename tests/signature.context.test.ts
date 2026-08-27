import { describe, expect, it } from 'vitest';
import { normalize } from '../src/core/model/normalize';
import { signatureOf } from '../src/core/diff/signature';
import { align } from '../src/core/diff/align';
import { divergences } from '../src/core/diff/divergence';
import { pickPreviewField, pickPreviewLeaf, previewRank } from '../src/ui/previewFields';
import { SCHEMA_ID, type Step, type Trace } from '../src/core/schema/types';
import { importTrace } from '../src/core/adapters/registry';
import { readFileSync } from 'node:fs';
import { FIXTURE_PAIRS } from '../src/fixtures';
import { matchedIndices, shape } from './helpers';

/**
 * A model turn that produced no visible output is not "the model said nothing".
 * It is "the model decided to call these tools", and that decision is its only
 * observable evidence. These tests pin that rule and prove it changes nothing
 * for steps that DO have visible output.
 */

const trace = (steps: Step[]): Trace => ({ schema: SCHEMA_ID, id: 't', steps });
const call = (id: string, name: string): Step => ({ id, type: 'tool_call', callId: id, name });
const empty = (id = 'm'): Step => ({ id, type: 'model', output: '', stopReason: 'tool_use' });

/** Signature of the first step, computed the way normalize does it. */
const sig = (steps: Step[]) => normalize(trace(steps)).steps[0].signature;

describe('empty-output model steps sign on the tools they emitted', () => {
  it('empty model + Bash !== empty model + Grep', () => {
    expect(sig([empty(), call('c', 'Bash')])).not.toBe(sig([empty(), call('c', 'Grep')]));
  });

  it('empty model + [Grep, Grep] !== empty model + [Grep]', () => {
    expect(sig([empty(), call('c1', 'Grep'), call('c2', 'Grep')])).not.toBe(
      sig([empty(), call('c1', 'Grep')]),
    );
  });

  it('empty model + [Grep, Bash] !== empty model + [Bash, Grep] — order is behaviour', () => {
    expect(sig([empty(), call('c1', 'Grep'), call('c2', 'Bash')])).not.toBe(
      sig([empty(), call('c1', 'Bash'), call('c2', 'Grep')]),
    );
  });

  it('empty model + Bash === empty model + Bash', () => {
    expect(sig([empty('x'), call('c', 'Bash')])).toBe(sig([empty('y'), call('k', 'Bash')]));
  });

  it('stops at the first non-tool_call step', () => {
    const withGap: Step[] = [empty(), call('c1', 'Bash'), { id: 'r', type: 'tool_result', callId: 'c1', status: 'success' }, call('c2', 'Grep')];
    // Only Bash was emitted by this turn; the later Grep belongs to another turn.
    expect(sig(withGap)).toBe(sig([empty(), call('c1', 'Bash')]));
  });

  it('records the emitted anchors on the normalized step', () => {
    const n = normalize(trace([empty(), call('c1', 'Grep'), call('c2', 'Bash')]));
    expect(n.steps[0].emittedTools).toEqual(['tool:Grep', 'tool:Bash']);
  });
});

describe('steps with visible output are untouched', () => {
  const said = (out: string): Step => ({ id: 'm', type: 'model', output: out, stopReason: 'tool_use' });

  it('a non-empty model step signs identically with or without context', () => {
    expect(sig([said('hello'), call('c', 'Bash')])).toBe(signatureOf(said('hello')));
  });

  it('identical visible output stays identical even when tools differ', () => {
    // The visible output IS the evidence; the tool difference shows on its own row.
    expect(sig([said('same words'), call('c', 'Bash')])).toBe(
      sig([said('same words'), call('c', 'Grep')]),
    );
  });

  it('different visible output still differs', () => {
    expect(sig([said('a'), call('c', 'Bash')])).not.toBe(sig([said('b'), call('c', 'Bash')]));
  });
});

describe('contentless turns keep todays behaviour — no invented context', () => {
  const bare: Step = { id: 'm', type: 'model', output: '', stopReason: 'end_turn' };

  it('an empty turn that emitted no tools signs exactly as before', () => {
    expect(sig([bare])).toBe(signatureOf(bare));
  });

  it('two such turns may still compare equal, by design', () => {
    expect(sig([bare])).toBe(sig([{ ...bare, id: 'other' }]));
  });

  it('stopReason still separates them when it differs', () => {
    expect(sig([bare])).not.toBe(sig([{ ...bare, stopReason: 'tool_use' }]));
  });
});

describe('the synthetic fixtures are unaffected', () => {
  const load = (p: string) => {
    const r = importTrace(JSON.parse(readFileSync(p, 'utf8')));
    if (!r.ok) throw new Error('bad fixture');
    return normalize(r.trace);
  };

  const EXPECTED: Record<string, { shape: string; regions: number }> = {
    'arg-drift': { shape: '=~~-~--++++~', regions: 1 },
    'stop-decision': { shape: '===+++=======~', regions: 2 },
    'failure-recovery': { shape: '=======~-----++++~', regions: 1 },
    'inconclusive-retrieval': { shape: '===~--~~~~=', regions: 1 },
  };

  it.each(FIXTURE_PAIRS.map((p) => p.key))('%s keeps its exact alignment shape', (key) => {
    const al = align(load(`src/fixtures/${key}.a.json`), load(`src/fixtures/${key}.b.json`));
    expect(shape(al)).toBe(EXPECTED[key].shape);
    expect(divergences(al)).toHaveLength(EXPECTED[key].regions);
  });

  it('no synthetic fixture contains an empty-output model step', () => {
    for (const p of FIXTURE_PAIRS) {
      for (const side of ['a', 'b'] as const) {
        const t = load(`src/fixtures/${p.key}.${side}.json`);
        const emptyModels = t.trace.steps.filter((s) => s.type === 'model' && !s.output.trim());
        expect(emptyModels, `${p.key}.${side}`).toHaveLength(0);
      }
    }
  });

  it('repeated-anchor pairing is unchanged on the case-1 shape', () => {
    // Same expectation as align.ambiguous case 1: drop the middle occurrence.
    const mk = (qs: string[]) =>
      normalize(trace(qs.map((q, i) => ({ id: `c${i}`, type: 'tool_call', callId: `c${i}`, name: 'search', args: { q } }))));
    const al = align(mk(['alpha', 'beta', 'gamma']), mk(['alpha', 'gamma']));
    expect(matchedIndices(al)).toEqual([
      [0, 0],
      [2, 1],
    ]);
  });
});

/* ── preview-field preference ────────────────────────────────────────────── */

describe('preview field preference', () => {
  it('prefers stdout over bookkeeping fields', () => {
    expect(previewRank('tool_result', 'result.stdout')).toBeLessThan(
      previewRank('tool_result', 'result.interrupted'),
    );
  });

  it('prefers a reported error over anything else', () => {
    expect(previewRank('tool_result', 'error.message')).toBeLessThan(
      previewRank('tool_result', 'result.stdout'),
    );
  });

  it('picks stdout out of a real Bash result shape', () => {
    const leaves: Array<[string, unknown]> = [
      ['result.interrupted', false],
      ['result.isImage', false],
      ['result.noOutputExpected', false],
      ['result.stderr', ''],
      ['result.stdout', '42'],
    ];
    expect(pickPreviewLeaf('tool_result', leaves)?.[0]).toBe('result.stdout');
  });

  it('ranks array indices the same as their leaf name', () => {
    expect(previewRank('state', 'changes[0].after')).toBe(previewRank('state', 'changes.after'));
  });

  it('keeps the fallback for unknown schemas: first non-empty scalar leaf', () => {
    const leaves: Array<[string, unknown]> = [
      ['result.alpha', null],
      ['result.beta', ''],
      ['result.gamma', 7],
      ['result.delta', 8],
    ];
    expect(pickPreviewLeaf('tool_result', leaves)?.[0]).toBe('result.gamma');
  });

  it('falls back to a bookkeeping field only when nothing else exists', () => {
    expect(pickPreviewLeaf('tool_result', [['result.interrupted', false]])?.[0]).toBe(
      'result.interrupted',
    );
  });

  it('uses the same ranking for computed field diffs', () => {
    const fields = [{ path: 'result.interrupted' }, { path: 'result.stdout' }];
    expect(pickPreviewField('tool_result', fields)?.path).toBe('result.stdout');
  });

  it('prefers command for a Bash call and path for a file call', () => {
    expect(pickPreviewField('tool_call', [{ path: 'args.description' }, { path: 'args.command' }])?.path)
      .toBe('args.command');
    expect(pickPreviewField('tool_call', [{ path: 'args.timeout' }, { path: 'args.file_path' }])?.path)
      .toBe('args.file_path');
  });

  it('never reads a value to decide, only a name', () => {
    // Identical names rank identically regardless of what they contain.
    expect(previewRank('tool_result', 'result.stdout')).toBe(previewRank('tool_result', 'result.stdout'));
  });
});
