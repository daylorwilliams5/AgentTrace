import { useState } from 'react';
import type { Divergence } from '../core/diff/divergence';
import type { NormalizedTrace, StepType } from '../core/schema/types';
import { STEP_TYPES } from '../core/schema/types';
import { useApp, type LoadedTrace } from '../state/store';
import { TYPE_LABEL, fmtDur, typeColor } from './format';

export function TraceList({
  traces,
  primary,
  secondary,
  onAssign,
}: {
  traces: LoadedTrace[];
  primary: string | null;
  secondary: string | null;
  onAssign: (key: string) => void;
}) {
  // Which traces have their import-warning disclosure open. Local UI state:
  // nothing about a warning is persisted or acted on.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="at-rail__section">
      <div className="at-rail__heading">
        <span>traces</span>
        <span>{traces.length}</span>
      </div>
      {traces.map((t) => {
        const slot = t.key === primary ? 'a' : t.key === secondary ? 'b' : null;
        const status = t.normalized.trace.status ?? 'unknown';
        const warn = t.warnings.length;
        const isOpen = warn > 0 && open.has(t.key);
        return (
          <div key={t.key}>
            <div className={`at-traceitem${slot ? ` at-traceitem--${slot}` : ''}`}>
              <button
                className="at-traceitem__main"
                onClick={() => onAssign(t.key)}
                title={`${t.fileName} — click to cycle A → B → off`}
              >
                <span className="at-traceitem__slot">{slot?.toUpperCase() ?? ''}</span>
                <span className={`at-dot at-dot--${status}`} />
                <span className="at-traceitem__name">{t.normalized.trace.name ?? t.key}</span>
                <span className="at-traceitem__n">{t.normalized.stats.total}</span>
              </button>
              {warn > 0 && (
                <button
                  className={`at-traceitem__warn${isOpen ? ' at-traceitem__warn--on' : ''}`}
                  onClick={() => toggle(t.key)}
                  aria-expanded={isOpen}
                  title={`${warn} import warning${warn === 1 ? '' : 's'} — imported anyway; click to show`}
                >
                  !{warn}
                </button>
              )}
            </div>
            {isOpen && (
              <div className="at-warnlist">
                <div className="at-warnlist__head">
                  import warnings · {t.fileName} · not blocking, nothing repaired
                </div>
                {t.warnings.map((w, i) => (
                  <div key={i} className="at-warn">
                    <span className="at-warn__where">{w.where}</span>
                    <span className="at-warn__msg">{w.message}</span>
                    <span className="at-warn__path">{w.path}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Filters({ counts }: { counts: Record<StepType, number> }) {
  const { typeFilter, toggleType, resetTypes, query, setQuery } = useApp();
  return (
    <>
      <div className="at-rail__section">
        <div className="at-rail__heading">
          <span>filter</span>
          <span className="at-kbd">/</span>
        </div>
        <input
          id="at-query"
          className="at-input"
          placeholder="search steps…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="at-rail__section">
        <div className="at-rail__heading">
          <span>types</span>
          <button className="at-btn" style={{ padding: '0 4px' }} onClick={resetTypes}>
            all
          </button>
        </div>
        {STEP_TYPES.map((t, i) => (
          <button
            key={t}
            className={`at-facet${typeFilter.has(t) ? '' : ' at-facet--off'}`}
            onClick={() => toggleType(t)}
            title={`toggle ${t} (${i + 1})`}
          >
            <span className="at-facet__bar" style={{ background: typeColor(t) }} />
            <span className="at-facet__name">{TYPE_LABEL[t]}</span>
            <span>{counts[t]}</span>
          </button>
        ))}
      </div>
    </>
  );
}

export function TraceStats({ t }: { t: NormalizedTrace }) {
  const s = t.stats;
  return (
    <div className="at-rail__section">
      <div className="at-rail__heading">
        <span>summary</span>
      </div>
      <div className="at-kv">
        <span className="at-kv__k">steps</span>
        <span className="at-kv__v">{s.total}</span>
        <span className="at-kv__k">tools</span>
        <span className="at-kv__v">{s.tools}</span>
        <span className="at-kv__k">errors</span>
        <span className="at-kv__v">{s.errors}</span>
        <span className="at-kv__k">retries</span>
        <span className="at-kv__v">{s.retries}</span>
        <span className="at-kv__k">wall</span>
        <span className="at-kv__v">{fmtDur(s.wallMs) || '—'}</span>
        <span className="at-kv__k">status</span>
        <span className="at-kv__v">{t.trace.status ?? 'unknown'}</span>
      </div>
    </div>
  );
}

/**
 * The divergence rail. This is what `n` / `p` step through, and in compare mode
 * it replaces the filter facets as the primary navigation surface — finding the
 * next place the runs differ is the job, not filtering by step type.
 */
export function DivergenceRail({
  divs,
  selected,
  onSelect,
  counts,
}: {
  divs: Divergence[];
  selected: number;
  onSelect: (i: number) => void;
  counts: { identical: number; changed: number; onlyA: number; onlyB: number };
}) {
  return (
    <>
      <div className="at-rail__section" style={{ padding: '8px 0 0' }}>
        <div className="at-rail__heading" style={{ padding: '0 var(--pad)' }}>
          <span>divergences</span>
          <span>{divs.length}</span>
        </div>
        {divs.length === 0 && (
          <div className="at-notice" style={{ padding: '4px var(--pad) 10px' }}>
            trajectories are identical
          </div>
        )}
        {divs.map((d) => (
          <button
            key={d.index}
            className={`at-div${d.index === selected ? ' at-div--sel' : ''}`}
            onClick={() => onSelect(d.index)}
          >
            <span className="at-div__head">
              <span className="at-div__n">{String(d.index + 1).padStart(2, '0')}</span>
              <span>
                row {d.startRow}
                {d.endRow > d.startRow ? `–${d.endRow}` : ''}
              </span>
              <span className="at-spacer" />
              <span>{d.kind}</span>
            </span>
            <span className="at-div__summary">{d.summary}</span>
          </button>
        ))}
      </div>
      <div className="at-rail__section">
        <div className="at-rail__heading">
          <span>alignment</span>
        </div>
        <div className="at-kv">
          <span className="at-kv__k">identical</span>
          <span className="at-kv__v">{counts.identical}</span>
          <span className="at-kv__k">changed</span>
          <span className="at-kv__v">{counts.changed}</span>
          <span className="at-kv__k">only A</span>
          <span className="at-kv__v">{counts.onlyA}</span>
          <span className="at-kv__k">only B</span>
          <span className="at-kv__v">{counts.onlyB}</span>
        </div>
      </div>
    </>
  );
}
