import { useEffect, useRef, useState } from 'react';
import type { Alignment } from '../../core/diff/align';
import type { Divergence } from '../../core/diff/divergence';
import type { NormalizedTrace } from '../../core/schema/types';
import { fmtDur } from '../format';
import { DifferenceRegion } from './DifferenceRegion';
import { MARK_GLYPH, plainAnchor, stepLabel } from './labels';
import { buildSegments, type SameSegment } from './segments';

/**
 * Trajectory View — the default compare experience.
 *
 * A single vertical spine that forks only where the aligned runs differ, and
 * merges back when they agree again. Identical behaviour collapses to one band
 * regardless of how many steps it covers, so a 100-step pair with three small
 * differences still reads in one screen.
 *
 * Consumes the same AlignedRow[] and Divergence[] as Trace View. No comparison
 * logic lives here.
 */

const STATUS_MARK: Record<string, 'ok' | 'fail' | 'neutral'> = {
  success: 'ok',
  failure: 'fail',
  partial: 'neutral',
  unknown: 'neutral',
};

function RunOutcome({ label, t }: { label: string; t: NormalizedTrace }) {
  const status = t.trace.status ?? 'unknown';
  const mark = STATUS_MARK[status] ?? 'neutral';
  return (
    <div className="tv-run">
      <div className="tv-run__label">run {label}</div>
      <div className={`tv-run__status tv-run__status--${mark}`}>
        <span className="tv-run__glyph">{MARK_GLYPH[mark]}</span>
        {status}
      </div>
      <div className="tv-run__meta">
        {t.stats.total} steps
        {t.stats.wallMs !== undefined ? ` · ${fmtDur(t.stats.wallMs)}` : ''}
      </div>
      <div className="tv-run__name">{t.trace.name ?? t.trace.id}</div>
    </div>
  );
}

/**
 * The banner, as a compressed clause list. Every clause is mechanically true:
 * status equality, a step-count subtraction, the index of the first differing
 * row, and whether any identical row follows the last difference. Nothing here
 * asserts why, and nothing is generated.
 */
function summaryLine(A: NormalizedTrace, B: NormalizedTrace, al: Alignment, divs: Divergence[]): string {
  if (divs.length === 0) return 'No differences · the runs behaved identically';

  const sa = A.trace.status ?? 'unknown';
  const sb = B.trace.status ?? 'unknown';
  const parts: string[] = [sa === sb ? `Both report ${sa}` : 'Different outcomes'];

  const delta = A.stats.total - B.stats.total;
  if (delta !== 0) {
    const who = delta > 0 ? 'Run A' : 'Run B';
    const n = Math.abs(delta);
    parts.push(`${who} took ${n} more step${n === 1 ? '' : 's'}`);
  }

  const first = al.rows[al.firstDivergenceRow];
  parts.push(`first difference at step ${((first?.a ?? first?.b)?.index ?? 0) + 1}`);

  // True only when a single difference region runs to the end. With identical
  // steps between two regions the runs DID match again.
  if (divs.length === 1 && divs[0].endRow === al.rows.length - 1) parts.push('paths do not rejoin');

  return parts.join(' · ');
}

function SameBand({ seg, A }: { seg: SameSegment; A: NormalizedTrace }) {
  const [open, setOpen] = useState(false);
  // A collapsed `stop` is the run's reported outcome, so name it from the
  // stop lexicon ("Goal met") rather than the bare step type ("stop").
  const names = [
    ...new Set(
      seg.rows.map((r) => {
        const s = r.a ?? r.b;
        return s && s.step.type === 'stop' ? stepLabel(s, A.steps).text : plainAnchor(r);
      }),
    ),
  ].slice(0, 4);
  const n = seg.rows.length;

  return (
    <div className="tv-same">
      <button className="tv-same__bar" onClick={() => setOpen((v) => !v)}>
        <span className="tv-same__dots">⋮</span>
        <span className="tv-same__n">
          {n} identical step{n === 1 ? '' : 's'}
        </span>
        <span className="tv-same__names">{names.join(' · ')}</span>
        <span className="tv-spacer" />
        <span className="tv-same__toggle">{open ? '⌃ hide' : '⌄ show'}</span>
      </button>
      {open && (
        <div className="tv-same__list">
          {seg.rows.map((r) => {
            const s = r.a ?? r.b;
            if (!s) return null;
            const l = stepLabel(s, A.steps);
            return (
              <div key={r.index} className="tv-same__item">
                <span className="tv-same__idx">{s.index}</span>
                <span>{l.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Spine() {
  return <div className="tv-spine" aria-hidden="true" />;
}

export function TrajectoryView({
  A,
  B,
  alignment,
  divs,
  selectedRow,
  onSelect,
}: {
  A: NormalizedTrace;
  B: NormalizedTrace;
  alignment: Alignment;
  divs: Divergence[];
  selectedRow: number;
  onSelect: (rowIndex: number) => void;
}) {
  const segments = buildSegments(alignment.rows, divs);
  const refs = useRef(new Map<number, HTMLDivElement>());
  const rowRef = (i: number) => (el: HTMLDivElement | null) => {
    if (el) refs.current.set(i, el);
    else refs.current.delete(i);
  };

  useEffect(() => {
    refs.current.get(selectedRow)?.scrollIntoView({ block: 'nearest' });
  }, [selectedRow]);

  let diffIndex = -1;

  return (
    <div className="tv-scroll">
      <div className="tv">
        <div className="tv-lanes tv-lanes--head">
          <div className="tv-lane tv-lane--a">
            <RunOutcome label="a" t={A} />
          </div>
          <div className="tv-chan tv-chan--open" />
          <div className="tv-lane tv-lane--b">
            <RunOutcome label="b" t={B} />
          </div>
        </div>

        <div className="tv-banner">{summaryLine(A, B, alignment, divs)}</div>

        <Spine />

        {segments.map((seg, i) => {
          if (seg.kind === 'same') {
            return (
              <div key={`s${i}`}>
                <SameBand seg={seg} A={A} />
                <Spine />
              </div>
            );
          }
          diffIndex++;
          return (
            <DifferenceRegion
              key={`d${i}`}
              seg={seg}
              index={diffIndex}
              isFirst={diffIndex === 0}
              A={A}
              B={B}
              selectedRow={selectedRow}
              onSelect={onSelect}
              rowRef={rowRef}
            />
          );
        })}
      </div>
    </div>
  );
}
