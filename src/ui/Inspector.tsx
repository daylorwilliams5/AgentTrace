import { useState } from 'react';
import type { AlignedRow } from '../core/diff/align';
import { auxiliaryDiff, type FieldDiff } from '../core/diff/fields';
import { wordDiff } from '../core/diff/words';
import type { NormalizedStep, Step } from '../core/schema/types';
import { GLYPH } from './compareRows';
import { TYPE_LABEL, fmtDur, fmtOffset, fmtValue, fmtValueShort, prettyJson, typeColor } from './format';

/* ── field diff — the highest-value surface in the product ──────────────── */

const OP_GLYPH: Record<FieldDiff['op'], string> = { added: '+', removed: '−', changed: '~' };

export function FieldDiffView({ diffs }: { diffs: FieldDiff[] }) {
  return (
    <div className="at-fd">
      <div className="at-fd__cols">
        <span />
        <span>field · A → B</span>
      </div>
      {diffs.map((d) => (
        <div key={d.path} className={`at-fd__row at-fd__row--${d.op}`}>
          <span className="at-fd__op">{OP_GLYPH[d.op]}</span>
          <span className="at-fd__path">{d.path}</span>
          <span className="at-fd__val">
            {d.op === 'changed' ? (
              <>
                <span className="at-fd__from">{fmtValueShort(d.before)}</span>
                <span className="at-fd__arrow">→</span>
                <span className="at-fd__to">{fmtValueShort(d.after)}</span>
              </>
            ) : (
              fmtValueShort(d.op === 'added' ? d.after : d.before)
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * An inline word diff is right for an EDIT and actively misleading for a
 * REPLACEMENT: interleaving two unrelated sentences word by word produces
 * something no one can read. Below this overlap threshold the two texts are
 * shown stacked instead, which is what they actually are.
 */
const INLINE_DIFF_MIN_OVERLAP = 0.35;

function TextChange({ a, b }: { a: string; b: string }) {
  const spans = wordDiff(a, b);
  const kept = spans.filter((s) => s.op === 'same').reduce((n, s) => n + s.text.trim().length, 0);
  const overlap = kept / Math.max(1, a.length, b.length);

  if (overlap < INLINE_DIFF_MIN_OVERLAP) {
    return (
      <div className="at-replace">
        <div className="at-replace__row at-replace__row--a">
          <span className="at-replace__op">−</span>
          <p className="at-text">{a}</p>
        </div>
        <div className="at-replace__row at-replace__row--b">
          <span className="at-replace__op">+</span>
          <p className="at-text">{b}</p>
        </div>
      </div>
    );
  }

  return (
    <p className="at-text">
      {spans.map((s, i) => (
        <span key={i} className={`at-wd__${s.op}`}>
          {s.text}
        </span>
      ))}
    </p>
  );
}

function Section({
  title,
  right,
  aux,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  aux?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`at-section${aux ? ' at-section--aux' : ''}`}>
      <div className="at-section__title">
        <span>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="at-btn"
      style={{ padding: '0 5px' }}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 900);
      }}
    >
      {done ? 'copied' : 'copy'}
    </button>
  );
}

/* ── per-type payload rendering ─────────────────────────────────────────── */

function payloadTabLabel(step: Step): string {
  switch (step.type) {
    case 'model':
      return 'output';
    case 'tool_call':
      return 'args';
    case 'tool_result':
      return 'result';
    case 'state':
      return 'changes';
    case 'error':
      return 'message';
    default:
      return 'detail';
  }
}

function Payload({ step }: { step: Step }) {
  switch (step.type) {
    case 'model':
      return <p className="at-text">{step.output || <span className="at-dim">(empty)</span>}</p>;
    case 'tool_call':
      return <pre className="at-json">{prettyJson(step.args)}</pre>;
    case 'tool_result':
      return (
        <>
          {!step.ok && step.error && (
            <p className="at-text" style={{ color: 'var(--t-error)' }}>
              {step.error.kind ? `${step.error.kind}: ` : ''}
              {step.error.message}
            </p>
          )}
          <pre className="at-json">{prettyJson(step.result)}</pre>
        </>
      );
    case 'state':
      return (
        <div className="at-fd">
          {step.changes.map((c) => (
            <div key={c.path} className="at-fd__row at-fd__row--changed">
              <span className="at-fd__op">~</span>
              <span className="at-fd__path">{c.path}</span>
              <span className="at-fd__val">
                <span className="at-fd__from">{fmtValue(c.before)}</span>
                <span className="at-fd__arrow">→</span>
                <span className="at-fd__to">{fmtValue(c.after)}</span>
              </span>
            </div>
          ))}
        </div>
      );
    case 'error':
      return (
        <>
          <p className="at-text" style={{ color: 'var(--t-error)' }}>
            {step.message}
          </p>
          {step.stack && <pre className="at-json">{step.stack}</pre>}
        </>
      );
    case 'retry':
      return (
        <p className="at-text">
          attempt {step.attempt}
          {step.reason ? ` — ${step.reason}` : ''}
          {step.backoffMs !== undefined ? ` (backoff ${fmtDur(step.backoffMs)})` : ''}
        </p>
      );
    case 'stop':
      return (
        <p className="at-text">
          {step.reason}
          {step.detail ? ` — ${step.detail}` : ''}
        </p>
      );
  }
}

export function MetaTable({ s, prefix }: { s: NormalizedStep; prefix?: string }) {
  const step = s.step;
  const rows: Array<[string, string]> = [
    ['id', step.id],
    ['index', String(s.index)],
    ['anchor', s.anchor],
    ['t', fmtOffset(s.offsetMs)],
    ['dur', fmtDur(step.dur) || '—'],
  ];
  if (step.type === 'tool_call' || step.type === 'tool_result') rows.push(['callId', step.callId]);
  if (step.type === 'model' && step.model) rows.push(['model', step.model]);
  if (step.type === 'model' && step.stopReason) rows.push(['stopReason', step.stopReason]);
  if (step.type === 'model' && step.tokens)
    rows.push(['tokens', `${step.tokens.in ?? '—'} in / ${step.tokens.out ?? '—'} out`]);
  if (step.attempt !== undefined) rows.push(['attempt', String(step.attempt)]);
  if (s.pairedIndex !== undefined) rows.push(['paired', `step ${s.pairedIndex}`]);

  return (
    <div className="at-kv">
      {rows.map(([k, v]) => (
        <span key={k} style={{ display: 'contents' }}>
          <span className="at-kv__k">{prefix ? `${prefix} ${k}` : k}</span>
          <span className="at-kv__v">{v}</span>
        </span>
      ))}
    </div>
  );
}

/* ── single-run inspector ───────────────────────────────────────────────── */

export function StepInspector({ s }: { s: NormalizedStep }) {
  const [tab, setTab] = useState<'payload' | 'aux' | 'raw'>('payload');
  const step = s.step;
  const hasAux = step.type === 'model' && !!step.analysis;
  const raw = prettyJson(step);

  return (
    <>
      <div className="at-insp__head">
        <div className="at-insp__title">
          <span style={{ color: typeColor(step.type) }}>{TYPE_LABEL[step.type]}</span>
          <span>{s.label}</span>
        </div>
        <div className="at-insp__sub">
          {step.id} · {s.anchor}
        </div>
      </div>
      <div className="at-tabs">
        <button
          className={`at-tab${tab === 'payload' ? ' at-tab--on' : ''}`}
          onClick={() => setTab('payload')}
        >
          {payloadTabLabel(step)}
        </button>
        {hasAux && (
          <button className={`at-tab${tab === 'aux' ? ' at-tab--on' : ''}`} onClick={() => setTab('aux')}>
            analysis
          </button>
        )}
        <button className={`at-tab${tab === 'raw' ? ' at-tab--on' : ''}`} onClick={() => setTab('raw')}>
          raw
        </button>
      </div>
      <div className="at-insp__body">
        {tab === 'payload' && (
          <Section title={payloadTabLabel(step)}>
            <Payload step={step} />
          </Section>
        )}
        {tab === 'aux' && step.type === 'model' && (
          <Section title="analysis" aux right={<span className="at-dim">not behavioural</span>}>
            <p className="at-text">{step.analysis}</p>
          </Section>
        )}
        {tab === 'raw' && (
          <Section title="raw json" right={<CopyButton text={raw} />}>
            <pre className="at-json">{raw}</pre>
          </Section>
        )}
        <Section title="step">
          <MetaTable s={s} />
        </Section>
      </div>
    </>
  );
}

/* ── compare inspector ──────────────────────────────────────────────────── */

export function RowInspector({ row }: { row: AlignedRow }) {
  const [tab, setTab] = useState<'diff' | 'a' | 'b' | 'raw'>('diff');
  const a = row.a;
  const b = row.b;
  const anchor = (a ?? b)?.anchor ?? '—';
  const aux = a && b ? auxiliaryDiff(a.step, b.step) : [];

  const modelOutputChanged =
    a?.step.type === 'model' &&
    b?.step.type === 'model' &&
    row.fields?.some((f) => f.path === 'output');

  return (
    <>
      <div className="at-insp__head">
        <div className="at-insp__title">
          <span
            style={{
              color:
                row.kind === 'changed'
                  ? 'var(--d-mod)'
                  : row.kind === 'onlyA'
                    ? 'var(--d-del)'
                    : row.kind === 'onlyB'
                      ? 'var(--d-add)'
                      : 'var(--fg-dim)',
            }}
          >
            {GLYPH[row.kind]} {row.kind}
          </span>
          <span>{anchor}</span>
        </div>
        <div className="at-insp__sub">
          row {row.index} · A {a ? a.step.id : '—'} · B {b ? b.step.id : '—'}
          {row.sim !== undefined && row.kind !== 'identical' ? ` · sim ${row.sim.toFixed(3)}` : ''}
        </div>
      </div>

      <div className="at-tabs">
        <button className={`at-tab${tab === 'diff' ? ' at-tab--on' : ''}`} onClick={() => setTab('diff')}>
          diff
        </button>
        <button
          className={`at-tab${tab === 'a' ? ' at-tab--on' : ''}`}
          onClick={() => setTab('a')}
          disabled={!a}
        >
          a
        </button>
        <button
          className={`at-tab${tab === 'b' ? ' at-tab--on' : ''}`}
          onClick={() => setTab('b')}
          disabled={!b}
        >
          b
        </button>
        <button className={`at-tab${tab === 'raw' ? ' at-tab--on' : ''}`} onClick={() => setTab('raw')}>
          raw
        </button>
      </div>

      <div className="at-insp__body">
        {tab === 'diff' && (
          <>
            {row.kind === 'changed' && row.fields && (
              <Section title="field diff" right={<span className="at-dim">{row.fields.length}</span>}>
                <FieldDiffView diffs={row.fields} />
              </Section>
            )}
            {modelOutputChanged && a && b && a.step.type === 'model' && b.step.type === 'model' && (
              <Section title="output">
                <TextChange a={a.step.output} b={b.step.output} />
              </Section>
            )}
            {row.kind === 'identical' && (
              <Section title="field diff">
                <p className="at-text at-dim">
                  Behaviourally identical. Same step, same payload.
                </p>
              </Section>
            )}
            {(row.kind === 'onlyA' || row.kind === 'onlyB') && (
              <Section title={row.kind === 'onlyA' ? 'only in A' : 'only in B'}>
                <p className="at-text at-dim" style={{ marginBottom: 8 }}>
                  No counterpart in run {row.kind === 'onlyA' ? 'B' : 'A'}.
                </p>
                {(a ?? b) && <Payload step={(a ?? b)!.step} />}
              </Section>
            )}
            {aux.length > 0 && (
              <Section title="analysis" aux right={<span className="at-dim">not behavioural</span>}>
                <FieldDiffView diffs={aux} />
              </Section>
            )}
            <Section title="steps">
              {a && <MetaTable s={a} prefix="A" />}
              {a && b && <div style={{ height: 6 }} />}
              {b && <MetaTable s={b} prefix="B" />}
            </Section>
          </>
        )}

        {tab === 'a' && a && (
          <>
            <Section title={`A · ${payloadTabLabel(a.step)}`}>
              <Payload step={a.step} />
            </Section>
            <Section title="step">
              <MetaTable s={a} />
            </Section>
          </>
        )}

        {tab === 'b' && b && (
          <>
            <Section title={`B · ${payloadTabLabel(b.step)}`}>
              <Payload step={b.step} />
            </Section>
            <Section title="step">
              <MetaTable s={b} />
            </Section>
          </>
        )}

        {tab === 'raw' && (
          <Section
            title="raw json"
            right={<CopyButton text={prettyJson({ a: a?.step ?? null, b: b?.step ?? null })} />}
          >
            <div className="at-sxs">
              <div className="at-sxs__col">
                <div className="at-sxs__head">a</div>
                <pre className="at-json">{a ? prettyJson(a.step) : '—'}</pre>
              </div>
              <div className="at-sxs__col">
                <div className="at-sxs__head">b</div>
                <pre className="at-json">{b ? prettyJson(b.step) : '—'}</pre>
              </div>
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
