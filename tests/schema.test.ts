import { describe, expect, it } from 'vitest';
import { importTrace, detectAdapter } from '../src/core/adapters/registry';
import { validateTrace } from '../src/core/schema/validate';
import { normalize } from '../src/core/model/normalize';
import { signatureOf } from '../src/core/diff/signature';
import { anchorOf } from '../src/core/diff/anchor';
import { SCHEMA_ID, type Trace } from '../src/core/schema/types';

const minimal = (steps: unknown[]): unknown => ({ schema: SCHEMA_ID, id: 't', steps });

describe('validation', () => {
  it('accepts a trace with only required fields', () => {
    const r = validateTrace(minimal([{ id: 's0', type: 'model', output: 'hi' }]));
    expect(r.ok).toBe(true);
  });

  it('accepts a trace with no timestamps at all', () => {
    const r = validateTrace(
      minimal([
        { id: 's0', type: 'tool_call', callId: 'c', name: 'search' },
        { id: 's1', type: 'tool_result', callId: 'c', ok: true },
      ]),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const n = normalize(r.trace);
      expect(n.steps.every((s) => s.offsetMs === undefined)).toBe(true);
      expect(n.stats.wallMs).toBeUndefined();
    }
  });

  it('reports the offending step by index and id', () => {
    const r = validateTrace(
      minimal([
        { id: 's0', type: 'model', output: 'ok' },
        { id: 's1', type: 'tool_result', callId: 'c', ok: 'yes' },
      ]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0].where).toBe('steps[1] (id=s1)');
      expect(r.issues[0].path).toBe('steps.1.ok');
    }
  });

  it('preserves unknown producer fields rather than stripping them', () => {
    const r = validateTrace(
      minimal([{ id: 's0', type: 'model', output: 'hi', producerSpecific: { seed: 7 } }]),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.trace.steps[0] as unknown as Record<string, unknown>).producerSpecific).toEqual({ seed: 7 });
    }
  });

  it('warns without failing on a dangling callId', () => {
    const r = validateTrace(minimal([{ id: 's0', type: 'tool_result', callId: 'nope', ok: true }]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].message).toMatch(/unknown callId/);
    }
  });

  it('warns on duplicate step ids', () => {
    const r = validateTrace(
      minimal([
        { id: 'dup', type: 'model', output: 'a' },
        { id: 'dup', type: 'model', output: 'b' },
      ]),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings[0].message).toMatch(/duplicate step id/);
  });
});

describe('adapter registry', () => {
  it('detects the native schema with full confidence', () => {
    expect(detectAdapter(minimal([]))?.score).toBe(1);
  });

  it('accepts a structurally-native file missing the discriminator, with lower confidence', () => {
    expect(detectAdapter({ id: 't', steps: [] })?.score).toBe(0.4);
  });

  it('reports an unrecognized file instead of throwing', () => {
    const r = importTrace({ hello: 'world' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].message).toMatch(/No adapter recognized/);
  });
});

describe('anchors', () => {
  it('resolves a tool_result name through its callId', () => {
    const trace: Trace = {
      schema: SCHEMA_ID,
      id: 't',
      steps: [
        { id: 's0', type: 'tool_call', callId: 'c', name: 'search' },
        { id: 's1', type: 'tool_result', callId: 'c', ok: true },
      ],
    };
    expect(normalize(trace).steps[1].anchor).toBe('result:search');
  });

  it('uses the root segment of state paths', () => {
    expect(
      anchorOf({
        id: 's',
        type: 'state',
        changes: [{ path: 'plan.steps[2].status' }, { path: 'plan.done' }],
      }),
    ).toBe('state:plan');
  });
});

describe('signatures', () => {
  const base = { id: 's0', type: 'tool_call', callId: 'c1', name: 'search', args: { q: 1 } } as const;

  it('ignores identifiers and timing', () => {
    expect(signatureOf({ ...base })).toBe(
      signatureOf({ ...base, id: 'zzz', callId: 'other', t: 999, dur: 12345 }),
    );
  });

  it('ignores presentational label and passthrough meta', () => {
    expect(signatureOf({ ...base })).toBe(
      signatureOf({ ...base, label: 'a totally different label', meta: { x: 1 }, tags: ['q'] }),
    );
  });

  it('is independent of object key order in args', () => {
    const one = signatureOf({ ...base, args: { a: 1, b: 2 } });
    const two = signatureOf({ ...base, args: { b: 2, a: 1 } });
    expect(one).toBe(two);
  });

  it('reacts to argument values', () => {
    expect(signatureOf({ ...base, args: { q: 1 } })).not.toBe(signatureOf({ ...base, args: { q: 2 } }));
  });

  it('ignores token accounting on model steps', () => {
    const m = { id: 'm', type: 'model', output: 'x' } as const;
    expect(signatureOf(m)).toBe(signatureOf({ ...m, tokens: { in: 10, out: 20 } }));
  });
});

describe('normalization', () => {
  it('derives labels when the producer supplies none', () => {
    const trace: Trace = {
      schema: SCHEMA_ID,
      id: 't',
      steps: [
        { id: 's0', type: 'model', output: 'First line.\nSecond line.' },
        { id: 's1', type: 'retry', attempt: 2, reason: 'timeout' },
      ],
    };
    const n = normalize(trace);
    expect(n.steps[0].label).toBe('First line.');
    expect(n.steps[1].label).toBe('attempt 2 — timeout');
  });

  it('counts failed tool results as errors', () => {
    const trace: Trace = {
      schema: SCHEMA_ID,
      id: 't',
      steps: [
        { id: 's0', type: 'tool_call', callId: 'c', name: 'f' },
        { id: 's1', type: 'tool_result', callId: 'c', ok: false, error: { message: 'boom' } },
      ],
    };
    expect(normalize(trace).stats.errors).toBe(1);
  });

  it('does not loop on a self-referential parent', () => {
    const trace: Trace = {
      schema: SCHEMA_ID,
      id: 't',
      steps: [{ id: 's0', type: 'model', output: 'x', parent: 's0' }],
    };
    expect(normalize(trace).steps[0].depth).toBe(0);
  });
});
