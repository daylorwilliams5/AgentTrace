import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { NormalizedStep } from '../core/schema/types';
import { StepCells } from './StepCells';

const ROW_H = 26;

/**
 * The single-run timeline. Deliberately built second: it exists to give context
 * around a divergence, and everything it shows is a subset of what a compare
 * row shows.
 */
export function Timeline({
  steps,
  selected,
  onSelect,
}: {
  steps: NormalizedStep[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtual = useVirtualizer({
    count: steps.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 24,
  });

  const pos = steps.findIndex((s) => s.index === selected);
  useEffect(() => {
    if (pos >= 0) virtual.scrollToIndex(pos, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  return (
    <>
      <div className="at-chead">
        <div className="at-chead__c" style={{ paddingLeft: 8 }}>
          <span className="at-row__idx">#</span>
          <span className="at-row__bar" style={{ background: 'transparent' }} />
          <span className="at-row__type">type</span>
          <span className="at-row__label">step</span>
          <span className="at-row__dur">dur</span>
        </div>
      </div>
      <div className="at-scroll" ref={scrollRef}>
        {steps.length === 0 ? (
          <div className="at-notice">No steps match the current filter.</div>
        ) : (
          <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
            {virtual.getVirtualItems().map((v) => {
              const s = steps[v.index];
              return (
                <div
                  key={s.step.id}
                  className={`at-row${s.index === selected ? ' at-row--sel' : ''}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${v.start}px)`,
                    paddingLeft: 8 + s.depth * 16,
                  }}
                  onClick={() => onSelect(s.index)}
                >
                  <StepCells s={s} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
