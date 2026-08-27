import { describe, expect, it } from 'vitest';
import {
  claudeCodeAdapter,
  convertTranscript,
  groupTurns,
  parseJsonl,
  redact,
  scanSecrets,
  splitRuns,
} from '../src/core/adapters/claude-code';
import { validateTrace } from '../src/core/schema/validate';
import { importTrace } from '../src/core/adapters/registry';
import { normalize } from '../src/core/model/normalize';
import type { CCRecord } from '../src/core/adapters/claude-code/records';

/**
 * Synthetic JSONL fixtures. Shapes are copied from a structural profile of real
 * transcripts (Claude Code 2.1.219–2.1.229); no real transcript content is used.
 *
 * These tests exist so that a failure in the real-session validation is
 * attributable: if grouping or pairing is wrong, the experiment would be
 * measuring this parser rather than AgentTrace.
 */

let seq = 0;
const ts = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();

function asst(id: string, blocks: unknown[], extra: Partial<CCRecord> = {}, at = seq++): CCRecord {
  return {
    type: 'assistant',
    uuid: `u${at}`,
    sessionId: 's1',
    timestamp: ts(at),
    version: '2.1.229',
    cwd: '/Users/tester/repo',
    message: {
      id,
      role: 'assistant',
      model: 'synthetic-model-1',
      content: blocks as never,
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
    },
    ...extra,
  };
}

function toolResult(useId: string, content: unknown, isError?: boolean, at = seq++): CCRecord {
  return {
    type: 'user',
    uuid: `u${at}`,
    sessionId: 's1',
    timestamp: ts(at),
    toolUseResult: content,
    message: {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: useId, ...(isError === undefined ? {} : { is_error: isError }) },
      ] as never,
    },
  };
}

function prompt(text: string, at = seq++): CCRecord {
  return {
    type: 'user',
    uuid: `u${at}`,
    sessionId: 's1',
    timestamp: ts(at),
    message: { role: 'user', content: text },
  };
}

const jsonl = (recs: CCRecord[]) => recs.map((r) => JSON.stringify(r)).join('\n') + '\n';

/* ── grouping: the load-bearing behaviour ────────────────────────────────── */

describe('message.id grouping', () => {
  const split = [
    asst('m1', [{ type: 'thinking', thinking: 'considering' }]),
    asst('m1', [{ type: 'text', text: 'I will look.' }]),
    asst('m1', [{ type: 'tool_use', id: 't1', name: 'Read', input: { path: 'a.ts' } }]),
  ];

  it('folds records sharing message.id into ONE turn', () => {
    const turns = groupTurns(split);
    expect(turns).toHaveLength(1);
    expect(turns[0].blocks.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use']);
  });

  it('produces one model step, not one per record', () => {
    const [{ trace, stats }] = convertTranscript(jsonl([prompt('go'), ...split]), { id: 'x' });
    expect(stats.assistantRecords).toBe(3);
    expect(stats.turns).toBe(1);
    expect(trace.steps.filter((s) => s.type === 'model')).toHaveLength(1);
  });

  it('routes text to output and thinking to analysis', () => {
    const [{ trace }] = convertTranscript(jsonl([prompt('go'), ...split]), { id: 'x' });
    const m = trace.steps.find((s) => s.type === 'model');
    expect(m).toMatchObject({ output: 'I will look.', analysis: 'considering' });
  });

  it('never merges records that lack a message.id', () => {
    const anon = [
      asst(undefined as unknown as string, [{ type: 'text', text: 'a' }]),
      asst(undefined as unknown as string, [{ type: 'text', text: 'b' }]),
    ];
    expect(groupTurns(anon)).toHaveLength(2);
  });
});

/* ── tool calls and results ──────────────────────────────────────────────── */

describe('tool call / result pairing', () => {
  const recs = [
    prompt('go'),
    asst('m1', [{ type: 'tool_use', id: 't1', name: 'Read', input: { path: 'a.ts' } }]),
    toolResult('t1', { content: 'hello' }, false),
  ];

  it('pairs by tool_use_id and carries the tool name onto the result', () => {
    const [{ trace }] = convertTranscript(jsonl(recs), { id: 'x' });
    const call = trace.steps.find((s) => s.type === 'tool_call');
    const res = trace.steps.find((s) => s.type === 'tool_result');
    expect(call).toMatchObject({ callId: 't1', name: 'Read', args: { path: 'a.ts' } });
    expect(res).toMatchObject({ callId: 't1', name: 'Read', status: 'success' });
  });

  it('normalizes into a resolvable anchor', () => {
    const [{ trace }] = convertTranscript(jsonl(recs), { id: 'x' });
    const n = normalize(trace);
    expect(n.steps.map((s) => s.anchor)).toEqual(['model', 'tool:Read', 'result:Read']);
  });

  it('measures tool duration from call to result', () => {
    const [{ trace }] = convertTranscript(jsonl(recs), { id: 'x' });
    const res = trace.steps.find((s) => s.type === 'tool_result');
    expect(res?.dur).toBe(1000);
  });

  it('counts a call that never received a result', () => {
    const [{ stats }] = convertTranscript(
      jsonl([prompt('go'), asst('m1', [{ type: 'tool_use', id: 't9', name: 'Read', input: {} }])]),
      { id: 'x' },
    );
    expect(stats.unansweredCalls).toBe(1);
  });
});

/* ── the ok tri-state ────────────────────────────────────────────────────── */

describe('tool result success is tri-state', () => {
  const mk = (isError?: boolean) =>
    convertTranscript(
      jsonl([
        prompt('go'),
        asst('m1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]),
        toolResult('t1', { stdout: 'out' }, isError),
      ]),
      { id: 'x' },
    )[0];

  it('is_error:true → confirmed failure, and emits an error step', () => {
    const { trace, stats } = mk(true);
    const res = trace.steps.find((s) => s.type === 'tool_result');
    expect(res).toMatchObject({ status: 'failure' });
    expect(trace.steps.some((s) => s.type === 'error')).toBe(true);
    expect(stats.okFalse).toBe(1);
  });

  it('is_error:false → confirmed success', () => {
    const { trace, stats } = mk(false);
    const res = trace.steps.find((s) => s.type === 'tool_result');
    expect(res).toMatchObject({ status: 'success' });
    expect(stats.okTrue).toBe(1);
  });

  it('is_error absent → status "unknown", never success', () => {
    const { trace, stats } = mk(undefined);
    const res = trace.steps.find((s) => s.type === 'tool_result');
    expect(res).toMatchObject({ status: 'unknown' });
    expect(res?.ok).toBeUndefined();
    expect(stats.okUnknown).toBe(1);
  });

  it('unknown is behaviourally distinct from success', () => {
    // Unlike the old meta marker, the tri-state IS part of the signature: a run
    // that confirmed success and one that reported nothing are not the same.
    const sig = (s: unknown) =>
      normalize({ ...mk(false).trace, steps: [s as never] }).steps[0].signature;
    expect(sig(mk(false).trace.steps.find((s) => s.type === 'tool_result'))).not.toBe(
      sig(mk(undefined).trace.steps.find((s) => s.type === 'tool_result')),
    );
  });

  it('never inspects result text to second-guess the reported status', () => {
    // The transcript says success; stdout says otherwise. Both are shown; the
    // status stays as reported.
    const { trace } = convertTranscript(
      jsonl([
        prompt('go'),
        asst('m1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]),
        toolResult('t1', { stdout: '(eval):1: no matches found: src/*.tsx' }, false),
      ]),
      { id: 'x' },
    )[0];
    const res = trace.steps.find((s) => s.type === 'tool_result');
    expect(res).toMatchObject({ status: 'success' });
    expect(JSON.stringify(res?.result)).toContain('no matches found');
  });
});

/* ── what the format does not contain ────────────────────────────────────── */

describe('absent concepts are absent, not invented', () => {
  const [{ trace }] = convertTranscript(
    jsonl([
      prompt('go'),
      asst('m1', [{ type: 'text', text: 'done' }], { message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'done' }] as never, stop_reason: 'end_turn' } }),
    ]),
    { id: 'x' },
  );

  it('emits no retry steps', () => {
    expect(trace.steps.some((s) => s.type === 'retry')).toBe(false);
  });
  it('emits no state steps', () => {
    expect(trace.steps.some((s) => s.type === 'state')).toBe(false);
  });
  it('emits no stop step — the transcript records no stopping decision', () => {
    expect(trace.steps.some((s) => s.type === 'stop')).toBe(false);
  });
  it('reports status unknown rather than guessing goal_met', () => {
    expect(trace.status).toBe('unknown');
  });
});

/* ── session splitting ───────────────────────────────────────────────────── */

describe('a session is a conversation, not a run', () => {
  const recs = [
    prompt('first task'),
    asst('m1', [{ type: 'text', text: 'a' }]),
    prompt('second task'),
    asst('m2', [{ type: 'text', text: 'b' }]),
  ];

  it('splits at human turns', () => {
    expect(splitRuns(recs)).toHaveLength(2);
  });

  it('sets task from the prompt that opened the run', () => {
    const all = convertTranscript(jsonl(recs), { id: 'x', run: 'all' });
    expect(all.map((r) => r.trace.task)).toEqual(['first task', 'second task']);
  });

  it('defaults to the last run', () => {
    const [only] = convertTranscript(jsonl(recs), { id: 'x' });
    expect(only.trace.task).toBe('second task');
  });
});

/* ── redaction and secrets ───────────────────────────────────────────────── */

describe('redaction', () => {
  const o = { level: 'paths' as const, home: '/Users/tester' };

  it('folds the home directory', () => {
    expect(redact({ p: '/Users/tester/repo/a.ts' }, o)).toEqual({ p: '~/repo/a.ts' });
  });

  it('is byte-deterministic — identical inputs never diff after redaction', () => {
    const big = { stdout: 'x'.repeat(5000) };
    const s = { level: 'strict' as const, home: '/Users/tester' };
    expect(JSON.stringify(redact(big, s))).toBe(JSON.stringify(redact(big, s)));
  });

  it('strict drops whole-file snapshots', () => {
    const out = redact({ originalFile: 'secret contents' }, { level: 'strict' }) as Record<string, unknown>;
    expect(out.originalFile).toBe('[removed by redaction]');
  });

  it('folds the dash-escaped home directory the same way', () => {
    // Claude Code encodes a project dir by replacing '/' with '-', so the home
    // directory also appears as `-Users-tester`, carrying the same username.
    expect(redact({ p: '/private/tmp/x/-Users-tester-Documents/s/repo' }, o)).toEqual({
      p: '/private/tmp/x/~-Documents/s/repo',
    });
  });

  it('folds both forms in one string', () => {
    expect(
      redact({ p: '/Users/tester/a and -Users-tester-Documents/b' }, o),
    ).toEqual({ p: '~/a and ~-Documents/b' });
  });

  it('dash-escaping is exact — a different user is untouched', () => {
    expect(redact({ p: '-Users-someoneelse-Documents' }, o)).toEqual({
      p: '-Users-someoneelse-Documents',
    });
  });

  it('remains byte-deterministic with both forms present', () => {
    const v = { p: '/Users/tester/x -Users-tester-y'.repeat(50) };
    expect(JSON.stringify(redact(v, o))).toBe(JSON.stringify(redact(v, o)));
  });

  it('level none is a pass-through', () => {
    const v = { p: '/Users/tester/x' };
    expect(redact(v, { level: 'none' })).toEqual(v);
  });
});

describe('secret sweep', () => {
  it('detects common credential shapes and reports where, not what', () => {
    const hits = scanSecrets({
      steps: [{ result: { stdout: 'export AWS_KEY=AKIAIOSFODNN7EXAMPLE' } }],
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].where).toContain('stdout');
    expect(JSON.stringify(hits)).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('is quiet on ordinary content', () => {
    expect(scanSecrets({ output: 'read src/core/align.ts and counted 77 tests' })).toEqual([]);
  });
});

/* ── registry integration ────────────────────────────────────────────────── */

describe('adapter contract', () => {
  const text = jsonl([prompt('go'), asst('m1', [{ type: 'text', text: 'hi' }])]);

  it('detects transcripts with confidence, and declines other JSON', () => {
    expect(claudeCodeAdapter.detect(text)).toBeGreaterThan(0.8);
    expect(claudeCodeAdapter.detect({ hello: 'world' })).toBe(0);
    expect(claudeCodeAdapter.detect('')).toBe(0);
  });

  it('produces a trace that passes schema validation', () => {
    const r = validateTrace(claudeCodeAdapter.parse(text));
    expect(r.ok, r.ok ? '' : JSON.stringify(r.issues)).toBe(true);
  });

  it('survives a truncated final line', () => {
    expect(() => parseJsonl(text + '{"type":"assis')).not.toThrow();
    expect(parseJsonl(text + '{"type":"assis')).toHaveLength(2);
  });
});

/* ── registered import path ──────────────────────────────────────────────── */

describe('raw .jsonl is a real import path', () => {
  const text = jsonl([
    prompt('go'),
    asst('m1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
    toolResult('t1', { stdout: 'a.ts' }, undefined),
    asst('m2', [{ type: 'text', text: 'done' }]),
  ]);

  it('routes through the registry to the claude-code adapter', () => {
    const r = importTrace(text);
    expect(r.ok, r.ok ? '' : JSON.stringify(r.issues)).toBe(true);
    if (r.ok) expect(r.adapterId).toBe('claude-code');
  });

  it('does not steal files that belong to the native adapter', () => {
    const native = { schema: 'agenttrace/v1', id: 'n', steps: [] };
    const r = importTrace(native);
    expect(r.ok && r.adapterId).toBe('native');
  });

  it('reports its limitations rather than hiding them', () => {
    const r = importTrace(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const msgs = r.warnings.map((w) => w.message).join('\n');
    expect(msgs).toMatch(/no stopping decision/);
    expect(msgs).toMatch(/no retries and no state changes/);
    expect(msgs).toMatch(/status "unknown"/);
  });

  it('flags a session that held more than one prompt', () => {
    const two = jsonl([prompt('first'), asst('m1', [{ type: 'text', text: 'a' }]), prompt('second'), asst('m2', [{ type: 'text', text: 'b' }])]);
    const r = importTrace(two);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.message).join('\n')).toMatch(/2 prompts; imported the last one/);
  });

  it('flags a call that never received a result', () => {
    const mid = jsonl([prompt('go'), asst('m1', [{ type: 'tool_use', id: 't9', name: 'Read', input: {} }])]);
    const r = importTrace(mid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.map((w) => w.message).join('\n')).toMatch(/never received a result/);
  });

  it('folds the home directory it finds in the transcript cwd', () => {
    const withHome = jsonl([
      prompt('go'),
      asst('m1', [{ type: 'tool_use', id: 't1', name: 'Read', input: { path: '/Users/tester/repo/a.ts' } }], {
        cwd: '/Users/tester/repo',
      }),
    ]);
    const r = importTrace(withHome);
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.stringify(r.trace)).toContain('~/repo/a.ts');
    if (r.ok) expect(JSON.stringify(r.trace)).not.toContain('/Users/tester');
  });
});
