import type { AlignedRow } from '../core/diff/align';
import type { NormalizedStep, StepType } from '../core/schema/types';
import { STEP_TYPES } from '../core/schema/types';
import { TYPE_LABEL, typeColor } from './format';

/**
 * The run, compressed to full width. The one place where the trace is spatial
 * rather than listed.
 *
 * Single-run: segments are proportional to duration, so "60% of the wall clock
 * went into one tool call" is visible without reading a number.
 *
 * Compare: segments are one-per-aligned-row instead. Both strips then share an
 * x-axis, which is what makes the divergence-point rule meaningful — everything
 * left of it is shared history. Identical rows are dimmed, so `bright = differs`
 * reads at a glance. Timing lives in the rows; the compare strip's job is where.
 */

function tickable(type: StepType): boolean {
  return type === 'error' || type === 'retry';
}

export function SingleStrip({
  steps,
  selected,
  onSelect,
}: {
  steps: NormalizedStep[];
  selected: number;
  onSelect: (i: number) => void;
}) {
  const total = steps.reduce((sum, s) => sum + (s.step.dur ?? 0), 0);
  return (
    <div className="at-strip">
      <div className="at-strip__key">A</div>
      <div className="at-strip__track">
        {steps.map((s) => (
          <div
            key={s.step.id}
            className={`at-strip__seg${s.index === selected ? ' at-strip__seg--sel' : ''}`}
            style={{
              flexGrow: total > 0 ? (s.step.dur ?? 0) + total / steps.length / 8 : 1,
              background: typeColor(s.step.type),
            }}
            title={`${s.index} ${s.step.type} — ${s.label}`}
            onClick={() => onSelect(s.index)}
          >
            {tickable(s.step.type) && <span className="at-strip__tick" />}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CompareStrips({
  rows,
  selectedRow,
  firstDivergenceRow,
  onSelect,
}: {
  rows: AlignedRow[];
  selectedRow: number;
  firstDivergenceRow: number;
  onSelect: (i: number) => void;
}) {
  const rulePct = firstDivergenceRow >= 0 ? (firstDivergenceRow / rows.length) * 100 : -1;
  return (
    <>
      <Side label="A" side="a" rows={rows} sel={selectedRow} rule={rulePct} onSelect={onSelect} />
      <Side label="B" side="b" rows={rows} sel={selectedRow} rule={rulePct} onSelect={onSelect} />
    </>
  );
}

function Side({
  label,
  side,
  rows,
  sel,
  rule,
  onSelect,
}: {
  label: string;
  side: 'a' | 'b';
  rows: AlignedRow[];
  sel: number;
  rule: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="at-strip">
      <div className="at-strip__key">{label}</div>
      <div className="at-strip__track">
        {rows.map((r) => {
          const step = r[side];
          const identical = r.kind === 'identical';
          return (
            <div
              key={r.index}
              className={
                'at-strip__seg' +
                (identical ? ' at-strip__seg--dim' : '') +
                (step ? '' : ' at-strip__seg--gap') +
                (r.index === sel ? ' at-strip__seg--sel' : '')
              }
              style={{
                flexGrow: 1,
                background: step ? typeColor(step.step.type) : 'transparent',
              }}
              title={step ? `row ${r.index} · ${r.kind} · ${step.label}` : `row ${r.index} · ${r.kind}`}
              onClick={() => onSelect(r.index)}
            >
              {step && tickable(step.step.type) && !identical && <span className="at-strip__tick" />}
            </div>
          );
        })}
        {rule >= 0 && <div className="at-strip__rule" style={{ left: `${rule}%` }} />}
      </div>
    </div>
  );
}

export function StripLegend({ note }: { note?: string }) {
  return (
    <div className="at-strip__legend">
      {STEP_TYPES.map((t) => (
        <span key={t} className="at-strip__legenditem">
          <span className="at-strip__swatch" style={{ background: typeColor(t) }} />
          {TYPE_LABEL[t]}
        </span>
      ))}
      <span className="at-spacer" />
      {note && <span className="at-strip__legenditem">{note}</span>}
    </div>
  );
}
