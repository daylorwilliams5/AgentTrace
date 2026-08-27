import { useCallback, useEffect, useMemo, useState } from 'react';
import { align, AlignmentTooLargeError } from '../core/diff/align';
import { divergences } from '../core/diff/divergence';
import { STEP_TYPES, type StepType } from '../core/schema/types';
import { readFiles, pickFiles } from '../io/readFiles';
import { traceByKey, useApp } from '../state/store';
import { CompareView } from '../ui/CompareView';
import { EmptyState } from '../ui/EmptyState';
import { RowInspector, StepInspector } from '../ui/Inspector';
import { CompareStrips, SingleStrip, StripLegend } from '../ui/OverviewStrip';
import { DivergenceRail, Filters, TraceList, TraceStats } from '../ui/Rail';
import { Timeline } from '../ui/Timeline';
import { TopBar } from '../ui/TopBar';
import { matchesQuery } from '../ui/format';
import { TrajectoryView } from '../ui/trajectory/TrajectoryView';
import { DifferencesRail } from '../ui/trajectory/DifferencesRail';
import { DifferenceInspector } from '../ui/trajectory/DifferenceInspector';

export function App() {
  const s = useApp();
  const [dragging, setDragging] = useState(false);

  const A = traceByKey(s.traces, s.primary)?.normalized;
  const B = traceByKey(s.traces, s.secondary)?.normalized;
  const compare = !!A && !!B;
  const trajectory = compare && s.compareView === 'trajectory';

  /* ── alignment (memoized on the trace pair) ───────────────────────────── */
  const alignment = useMemo(() => {
    if (!A || !B) return null;
    try {
      return align(A, B);
    } catch (e) {
      if (e instanceof AlignmentTooLargeError) return e;
      throw e;
    }
  }, [A, B]);

  const ok = alignment && !(alignment instanceof AlignmentTooLargeError) ? alignment : null;
  const divs = useMemo(() => (ok ? divergences(ok) : []), [ok]);

  /* ── single-run filtering ─────────────────────────────────────────────── */
  const visible = useMemo(() => {
    if (!A) return [];
    return A.steps.filter(
      (st) => s.typeFilter.has(st.step.type) && matchesQuery(st.step, st.label, s.query),
    );
  }, [A, s.typeFilter, s.query]);

  const typeCounts = useMemo(() => {
    const c = Object.fromEntries(STEP_TYPES.map((t) => [t, 0])) as Record<StepType, number>;
    for (const st of A?.steps ?? []) c[st.step.type]++;
    return c;
  }, [A]);

  /* ── divergence navigation — the primary interaction ──────────────────── */
  const goToDivergence = useCallback(
    (i: number) => {
      if (!divs.length) return;
      const idx = ((i % divs.length) + divs.length) % divs.length;
      s.setSelectedDivergence(idx, divs[idx].startRow);
    },
    [divs, s],
  );

  const nextDivergence = useCallback(() => {
    if (!divs.length) return;
    // Jump relative to where the cursor actually is, not to a stale index.
    const after = divs.findIndex((d) => d.startRow > s.selectedRow);
    goToDivergence(after === -1 ? 0 : after);
  }, [divs, s.selectedRow, goToDivergence]);

  const prevDivergence = useCallback(() => {
    if (!divs.length) return;
    const before = [...divs].reverse().find((d) => d.startRow < s.selectedRow);
    goToDivergence(before ? before.index : divs.length - 1);
  }, [divs, s.selectedRow, goToDivergence]);

  /* On entering compare, land on the first observed divergence immediately. */
  useEffect(() => {
    if (compare && divs.length) s.setSelectedDivergence(0, divs[0].startRow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare, ok]);

  /* ── import ───────────────────────────────────────────────────────────── */
  const doImport = useCallback(() => {
    void pickFiles().then((r) => s.load(r.filter((f) => !f.parseError)));
  }, [s]);

  /* ── keyboard ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        if (e.key === 'Escape') el.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const rows = ok?.rows ?? [];
      switch (e.key) {
        case 'n':
          if (compare) { e.preventDefault(); nextDivergence(); }
          break;
        case 'p':
          if (compare) { e.preventDefault(); prevDivergence(); }
          break;
        case 'j':
          e.preventDefault();
          if (compare) s.setSelectedRow(Math.min(s.selectedRow + 1, rows.length - 1));
          else s.setSelectedStep(stepAfter(visible.map((v) => v.index), s.selectedStep, 1));
          break;
        case 'k':
          e.preventDefault();
          if (compare) s.setSelectedRow(Math.max(s.selectedRow - 1, 0));
          else s.setSelectedStep(stepAfter(visible.map((v) => v.index), s.selectedStep, -1));
          break;
        case 'f':
          if (compare) { e.preventDefault(); s.toggleFold(); }
          break;
        case '/':
          e.preventDefault();
          document.getElementById('at-query')?.focus();
          break;
        case 'Escape':
          if (compare) s.clearSecondary();
          break;
        default:
          if (/^[1-7]$/.test(e.key)) {
            e.preventDefault();
            s.toggleType(STEP_TYPES[Number(e.key) - 1]);
          }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compare, ok, visible, s, nextDivergence, prevDivergence]);

  /* ── drag & drop ──────────────────────────────────────────────────────── */
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (!e.dataTransfer.files.length) return;
      void readFiles(e.dataTransfer.files).then((r) => s.load(r.filter((f) => !f.parseError)));
    },
    [s],
  );

  const selectedRow = ok?.rows[s.selectedRow];
  const selectedStep = A?.steps[s.selectedStep];

  return (
    <div
      className={`at-app${s.traces.length === 0 ? ' at-app--empty' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <TopBar
        a={A}
        b={B}
        view={s.compareView}
        onView={s.setCompareView}
        divs={divs}
        selectedDivergence={s.selectedDivergence}
        fold={s.foldIdentical}
        onFold={s.toggleFold}
        onPrev={prevDivergence}
        onNext={nextDivergence}
        onExit={s.clearSecondary}
        onImport={doImport}
      />

      <div className="at-strip-area" hidden={trajectory}>
        {trajectory ? null : compare && ok ? (
          <>
            <CompareStrips
              rows={ok.rows}
              selectedRow={s.selectedRow}
              firstDivergenceRow={ok.firstDivergenceRow}
              onSelect={s.setSelectedRow}
            />
            <StripLegend note={`dimmed = identical · dashed rule = divergence point`} />
          </>
        ) : A ? (
          <>
            <SingleStrip steps={A.steps} selected={s.selectedStep} onSelect={s.setSelectedStep} />
            <StripLegend note="width ∝ duration" />
          </>
        ) : null}
      </div>

      {s.traces.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="at-rail">
            <TraceList
              traces={s.traces}
              primary={s.primary}
              secondary={s.secondary}
              onAssign={s.assign}
            />
            {trajectory && ok ? (
              <DifferencesRail divs={divs} selected={s.selectedDivergence} onSelect={goToDivergence} />
            ) : compare && ok ? (
              <DivergenceRail
                divs={divs}
                selected={s.selectedDivergence}
                onSelect={goToDivergence}
                counts={ok.counts}
              />
            ) : A ? (
              <>
                <Filters counts={typeCounts} />
                <TraceStats t={A} />
              </>
            ) : null}
          </div>

          <div className="at-main">
            {alignment instanceof AlignmentTooLargeError ? (
              <div className="at-notice">{alignment.message}</div>
            ) : trajectory && ok ? (
              <TrajectoryView
                A={A!}
                B={B!}
                alignment={ok}
                divs={divs}
                selectedRow={s.selectedRow}
                onSelect={s.setSelectedRow}
              />
            ) : compare && ok ? (
              <CompareView
                rows={ok.rows}
                selectedRow={s.selectedRow}
                fold={s.foldIdentical}
                expanded={s.expandedFolds}
                nameA={A!.trace.name ?? A!.trace.id}
                nameB={B!.trace.name ?? B!.trace.id}
                onSelect={s.setSelectedRow}
                onExpand={s.expandFold}
              />
            ) : A ? (
              <Timeline steps={visible} selected={s.selectedStep} onSelect={s.setSelectedStep} />
            ) : (
              <div className="at-notice">Select a trace in the rail.</div>
            )}
          </div>

          <div className="at-inspector">
            {trajectory && selectedRow ? (
              <DifferenceInspector key={selectedRow.index} row={selectedRow} A={A!} B={B!} />
            ) : compare && selectedRow ? (
              <RowInspector key={selectedRow.index} row={selectedRow} />
            ) : selectedStep ? (
              <StepInspector key={selectedStep.step.id} s={selectedStep} />
            ) : (
              <div className="at-notice">Nothing selected.</div>
            )}
          </div>
        </>
      )}

      {s.failures.length > 0 && (
        <div className="at-errors" style={{ gridColumn: '1 / -1' }}>
          {s.failures.map((f) => (
            <div key={f.fileName}>
              {f.fileName}: {f.issues.map((i) => `${i.where} — ${i.message}`).join('; ')}
            </div>
          ))}
          <button className="at-btn" onClick={s.dismissFailures} style={{ marginTop: 4 }}>
            dismiss
          </button>
        </div>
      )}

      {dragging && <div className="at-dragover">release to import</div>}
    </div>
  );
}

/** Step selection follows the filtered list, not the raw index. */
function stepAfter(indices: number[], current: number, dir: 1 | -1): number {
  if (indices.length === 0) return current;
  const at = indices.indexOf(current);
  if (at === -1) return indices[0];
  return indices[Math.max(0, Math.min(indices.length - 1, at + dir))];
}
