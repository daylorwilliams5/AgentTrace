import { useState } from 'react';
import type { AlignedRow } from '../../core/diff/align';
import { auxiliaryDiff, type FieldDiff } from '../../core/diff/fields';
import type { NormalizedTrace } from '../../core/schema/types';
import { MetaTable } from '../Inspector';
import { fmtValue, fmtDur, prettyJson } from '../format';
import { wordDiff } from '../../core/diff/words';
import { describeChange, isOkUnknown, isReplacement, stepLabel, subjectOf } from './labels';

/**
 * The Trajectory inspector.
 *
 * Priority is the human-readable difference; ids, timestamps, callIds, anchors,
 * pairing scores and raw JSON are all still here, but demoted behind
 * "Inspect raw data". Nothing is removed — only reordered.
 */

const GROUP_TITLE: Record<FieldDiff['op'], string> = {
  removed: 'Removed from run B',
  added: 'Added in run B',
  changed: 'Changed',
};

function FieldGroup({ op, fields }: { op: FieldDiff['op']; fields: FieldDiff[] }) {
  if (fields.length === 0) return null;
  return (
    <div className={`ti-group ti-group--${op}`}>
      <div className="ti-group__title">{GROUP_TITLE[op]}</div>
      {fields.map((f) => (
        <div key={f.path} className="ti-field">
          <div className="ti-field__k">{f.path}</div>
          <div className="ti-field__v">
            {f.op === 'changed' ? (
              <>
                <span className="ti-from">{fmtValue(f.before)}</span>
                <span className="ti-arrow">→</span>
                <span className="ti-to">{fmtValue(f.after)}</span>
              </>
            ) : (
              fmtValue(f.op === 'added' ? f.after : f.before)
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DifferenceInspector({
  row,
  A,
  B,
}: {
  row: AlignedRow;
  A: NormalizedTrace;
  B: NormalizedTrace;
}) {
  const [raw, setRaw] = useState(false);

  const a = row.a;
  const b = row.b;
  const step = (a ?? b)?.step;
  const isModel = a?.step.type === 'model' && b?.step.type === 'model';
  const fields = row.fields ?? [];
  const aux = a && b ? auxiliaryDiff(a.step, b.step) : [];
  const okUnknown = (a && isOkUnknown(a)) || (b && isOkUnknown(b));

  const heading =
    row.kind === 'changed'
      ? isModel
        ? modelHeading(a!.step.type === 'model' ? a!.step.output : '', b!.step.type === 'model' ? b!.step.output : '')
        : describeChange(row)
      : row.kind === 'onlyA'
        ? 'Only in run A'
        : row.kind === 'onlyB'
          ? 'Only in run B'
          : 'Identical in both runs';

  return (
    <div className="ti">
      <div className="ti__head">
        <div className="ti__title">{subjectOf(row)}</div>
        <div className="ti__sub">{heading}</div>
      </div>

      <div className="ti__body">
        {okUnknown && (
          <p className="ti-text ti-dim" style={{ marginBottom: 14 }}>
            The source did not report whether this tool call succeeded.
          </p>
        )}
        {isModel && row.kind === 'changed' ? (
          <>
            <div className="ti-group">
              <div className="ti-group__title">Run A</div>
              <p className="ti-text">{a!.step.type === 'model' ? a!.step.output : ''}</p>
            </div>
            <div className="ti-group">
              <div className="ti-group__title">Run B</div>
              <p className="ti-text">{b!.step.type === 'model' ? b!.step.output : ''}</p>
            </div>
          </>
        ) : row.kind === 'changed' ? (
          <>
            <FieldGroup op="removed" fields={fields.filter((f) => f.op === 'removed')} />
            <FieldGroup op="added" fields={fields.filter((f) => f.op === 'added')} />
            <FieldGroup op="changed" fields={fields.filter((f) => f.op === 'changed')} />
          </>
        ) : row.kind === 'identical' ? (
          <p className="ti-text ti-dim">Both runs performed this step with the same content.</p>
        ) : (
          <SoloDetail row={row} A={A} B={B} />
        )}

        {aux.length > 0 && (
          <div className="ti-group ti-group--aux">
            <div className="ti-group__title">
              analysis <span className="ti-dim">· not part of the behavior comparison</span>
            </div>
            {aux.map((f) => (
              <div key={f.path} className="ti-field">
                <div className="ti-field__v">
                  <span className="ti-from">{fmtValue(f.before)}</span>
                  <span className="ti-arrow">→</span>
                  <span className="ti-to">{fmtValue(f.after)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <button className="ti-disclose" onClick={() => setRaw((v) => !v)}>
          {raw ? '⌃' : '⌄'} Inspect raw data
        </button>

        {raw && (
          <div className="ti-raw">
            {a && (
              <>
                <div className="ti-group__title">run a · step</div>
                <MetaTable s={a} />
              </>
            )}
            {b && (
              <>
                <div className="ti-group__title" style={{ marginTop: 10 }}>
                  run b · step
                </div>
                <MetaTable s={b} />
              </>
            )}
            <div className="ti-group__title" style={{ marginTop: 10 }}>
              raw json
            </div>
            <pre className="ti-json">{prettyJson({ a: a?.step ?? null, b: b?.step ?? null })}</pre>
            {step && <div className="ti-dim">duration a {fmtDur(a?.step.dur) || '—'} · b {fmtDur(b?.step.dur) || '—'}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Same threshold the rail uses, so the two surfaces never disagree. */
function modelHeading(a: string, b: string): string {
  const same = wordDiff(a, b)
    .filter((s) => s.op === 'same')
    .reduce((n, s) => n + s.text.trim().length, 0);
  return isReplacement(a, b, same) ? 'Output replaced' : 'Output changed';
}

function SoloDetail({ row, A, B }: { row: AlignedRow; A: NormalizedTrace; B: NormalizedTrace }) {
  const s = row.a ?? row.b;
  if (!s) return null;
  const steps = row.a ? A.steps : B.steps;
  const l = stepLabel(s, steps);
  const step = s.step;

  return (
    <>
      <div className="ti-group">
        <div className="ti-group__title">{l.text}</div>
        {l.sub && <p className="ti-text">{l.sub}</p>}
        {step.type === 'tool_call' && <pre className="ti-json">{prettyJson(step.args)}</pre>}
        {step.type === 'tool_result' && <pre className="ti-json">{prettyJson(step.result)}</pre>}
        {step.type === 'model' && <p className="ti-text">{step.output}</p>}
        {step.type === 'error' && <p className="ti-text">{step.message}</p>}
        {step.type === 'state' && (
          <div>
            {step.changes.map((c) => (
              <div key={c.path} className="ti-field">
                <div className="ti-field__k">{c.path}</div>
                <div className="ti-field__v">
                  <span className="ti-from">{fmtValue(c.before)}</span>
                  <span className="ti-arrow">→</span>
                  <span className="ti-to">{fmtValue(c.after)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
