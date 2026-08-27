import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AlignedRow } from '../core/diff/align';
import { buildDisplay, GLYPH } from './compareRows';
import { GapCells, StepCells } from './StepCells';

const ROW_H = 26;

/**
 * Compare mode.
 *
 * One scroll container, one row per aligned pair, laid out as [A | gutter | B].
 * The panes are locked by construction rather than by a scroll-sync heuristic,
 * because both sides are cells of the same row.
 *
 * Folding identical runs is the highest-leverage behaviour here: a 200-step
 * comparison collapses to the handful of places the runs actually differ.
 */
export function CompareView({
  rows,
  selectedRow,
  fold,
  expanded,
  nameA,
  nameB,
  onSelect,
  onExpand,
}: {
  rows: AlignedRow[];
  selectedRow: number;
  fold: boolean;
  expanded: Set<number>;
  nameA: string;
  nameB: string;
  onSelect: (rowIndex: number) => void;
  onExpand: (startRow: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const display = useMemo(() => buildDisplay(rows, fold, expanded), [rows, fold, expanded]);

  const virtual = useVirtualizer({
    count: display.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 24,
  });

  const pos = display.findIndex((d) => d.t === 'row' && d.row.index === selectedRow);
  useEffect(() => {
    if (pos >= 0) virtual.scrollToIndex(pos, { align: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  return (
    <>
      <div className="at-chead">
        <div className="at-chead__c">run A — {nameA}</div>
        <div className="at-chead__g" />
        <div className="at-chead__c">run B — {nameB}</div>
      </div>
      <div className="at-scroll" ref={scrollRef}>
        <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map((v) => {
            const d = display[v.index];
            const style = {
              position: 'absolute' as const,
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${v.start}px)`,
            };

            if (d.t === 'fold') {
              return (
                <div
                  key={`f${d.startRow}`}
                  className="at-crow at-fold"
                  style={style}
                  onClick={() => onExpand(d.startRow)}
                  title="click to expand"
                >
                  <button className="at-fold__c">
                    <span>⋯</span>
                    <span>{d.count} identical steps</span>
                    <span className="at-spacer" />
                    <span className="at-dim">expand</span>
                  </button>
                  <div className="at-crow__g">=</div>
                  <button className="at-fold__c">
                    <span>⋯</span>
                    <span>{d.count} identical steps</span>
                  </button>
                </div>
              );
            }

            const r = d.row;
            return (
              <div
                key={r.index}
                className={`at-crow at-crow--${r.kind}${r.index === selectedRow ? ' at-crow--sel' : ''}`}
                style={style}
                onClick={() => onSelect(r.index)}
              >
                <div className="at-row" style={{ height: ROW_H, borderLeft: 0 }}>
                  {r.a ? <StepCells s={r.a} /> : <GapCells />}
                </div>
                <div className="at-crow__g">{GLYPH[r.kind]}</div>
                <div className="at-row" style={{ height: ROW_H, borderLeft: 0 }}>
                  {r.b ? <StepCells s={r.b} /> : <GapCells />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
