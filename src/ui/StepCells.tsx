import type { NormalizedStep } from '../core/schema/types';
import { TYPE_LABEL, fmtDur, isFailure, typeColor } from './format';

/**
 * The contents of one step row: index · type gutter bar · type label · summary
 * · duration. Shared verbatim by the single-run timeline and both sides of the
 * compare view, so a row means the same thing everywhere.
 */
export function StepCells({ s }: { s: NormalizedStep }) {
  const failed = isFailure(s.step);
  return (
    <>
      <span className="at-row__idx">{s.index}</span>
      <span className="at-row__bar" style={{ background: typeColor(s.step.type) }} />
      <span className="at-row__type" style={{ color: typeColor(s.step.type) }}>
        {TYPE_LABEL[s.step.type]}
      </span>
      <span className={`at-row__label${failed ? ' at-row__fail' : ''}`}>{s.label}</span>
      <span className="at-row__dur">{fmtDur(s.step.dur)}</span>
    </>
  );
}

/** A dotted rule opposite an unmatched step. Absence has to be visible. */
export function GapCells() {
  return <span className="at-row__gap" />;
}
