import type { Divergence } from '../core/diff/divergence';
import type { NormalizedTrace } from '../core/schema/types';
import { fmtDur } from './format';

function ViewToggle({
  view,
  onChange,
}: {
  view: 'trajectory' | 'trace';
  onChange: (v: 'trajectory' | 'trace') => void;
}) {
  return (
    <span className="tv-toggle">
      <button
        className={`tv-toggle__b${view === 'trajectory' ? ' tv-toggle__b--on' : ''}`}
        onClick={() => onChange('trajectory')}
      >
        Trajectory
      </button>
      <button
        className={`tv-toggle__b${view === 'trace' ? ' tv-toggle__b--on' : ''}`}
        onClick={() => onChange('trace')}
      >
        Trace
      </button>
    </span>
  );
}

function TraceChip({ label, t }: { label: string; t: NormalizedTrace }) {
  const status = t.trace.status ?? 'unknown';
  return (
    <span className="at-topbar__meta" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span className="at-label" style={{ color: 'var(--fg-dim)' }}>
        {label}
      </span>
      <span style={{ color: 'var(--fg)' }}>{t.trace.name ?? t.trace.id}</span>
      <span className={`at-dot at-dot--${status}`} />
      <span>{status}</span>
    </span>
  );
}

export function TopBar({
  a,
  b,
  view,
  onView,
  divs,
  selectedDivergence,
  fold,
  onFold,
  onPrev,
  onNext,
  onExit,
  onImport,
}: {
  a?: NormalizedTrace;
  b?: NormalizedTrace;
  view: 'trajectory' | 'trace';
  onView: (v: 'trajectory' | 'trace') => void;
  divs: Divergence[];
  selectedDivergence: number;
  fold: boolean;
  onFold: () => void;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
  onImport: () => void;
}) {
  const compare = !!a && !!b;
  const trajectory = compare && view === 'trajectory';

  return (
    <div className="at-topbar">
      <span className="at-topbar__brand">agenttrace</span>
      <span className="at-sep" />

      {trajectory ? (
        <span className="at-topbar__title" title={a!.trace.task}>
          {a!.trace.task ?? `${a!.trace.name} ⇄ ${b!.trace.name}`}
        </span>
      ) : compare ? (
        <>
          <TraceChip label="A" t={a!} />
          <span className="at-dim">⇄</span>
          <TraceChip label="B" t={b!} />
        </>
      ) : a ? (
        <>
          <span className="at-topbar__title">{a.trace.name ?? a.trace.id}</span>
          <span className="at-topbar__meta">
            {a.trace.agent?.name}
            {a.trace.agent?.version ? ` ${a.trace.agent.version}` : ''}
            {a.trace.agent?.model ? ` · ${a.trace.agent.model}` : ''}
          </span>
          <span className="at-sep" />
          <span className="at-topbar__meta" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className={`at-dot at-dot--${a.trace.status ?? 'unknown'}`} />
            {a.trace.status ?? 'unknown'}
            <span className="at-dim">{fmtDur(a.stats.wallMs)}</span>
          </span>
        </>
      ) : (
        <span className="at-topbar__meta">no trace selected</span>
      )}

      <span className="at-spacer" />

      {compare && (
        <span className="at-topbar__group">
          <span className="at-topbar__meta">
            {divs.length} difference{divs.length === 1 ? '' : 's'}
          </span>
          <button className="at-btn" onClick={onPrev} disabled={divs.length < 2} title="previous difference (p)">
            ◂
          </button>
          <span className="at-topbar__meta" style={{ minWidth: 108, textAlign: 'center' }}>
            {divs.length ? `Difference ${Math.min(selectedDivergence + 1, divs.length)} of ${divs.length}` : '—'}
          </span>
          <button className="at-btn" onClick={onNext} disabled={divs.length < 2} title="next difference (n)">
            ▸
          </button>
          <span className="at-sep" />
          <ViewToggle view={view} onChange={onView} />
          {view === 'trace' && (
            <button className="at-btn" aria-pressed={fold} onClick={onFold} title="fold identical (f)">
              fold identical
            </button>
          )}
          <button className="at-btn" onClick={onExit} title="exit compare (esc)">
            exit
          </button>
        </span>
      )}
      <span className="at-topbar__group">
        <button className="at-btn" onClick={onImport}>
          import…
        </button>
      </span>
    </div>
  );
}
