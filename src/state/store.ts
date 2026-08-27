import { create } from 'zustand';
import { importTrace } from '../core/adapters/registry';
import { normalize } from '../core/model/normalize';
import type { NormalizedTrace, StepType } from '../core/schema/types';
import type { ValidationIssue } from '../core/schema/validate';
import { STEP_TYPES } from '../core/schema/types';

export interface LoadedTrace {
  /** Stable key; disambiguated when two files carry the same trace id. */
  key: string;
  fileName: string;
  normalized: NormalizedTrace;
  warnings: ValidationIssue[];
}

export interface ImportFailure {
  fileName: string;
  issues: ValidationIssue[];
}

interface AppState {
  traces: LoadedTrace[];
  /** Slot A. Single-run view when `secondary` is null. */
  primary: string | null;
  /** Slot B. Compare mode when non-null. */
  secondary: string | null;

  /** Trajectory is the default compare experience; Trace is the dense view. */
  compareView: 'trajectory' | 'trace';

  selectedStep: number;
  selectedRow: number;
  selectedDivergence: number;

  foldIdentical: boolean;
  expandedFolds: Set<number>;
  typeFilter: Set<StepType>;
  query: string;
  failures: ImportFailure[];

  setCompareView: (v: 'trajectory' | 'trace') => void;
  load: (files: Array<{ fileName: string; raw: unknown }>) => void;
  assign: (key: string) => void;
  clearSecondary: () => void;
  setSelectedStep: (i: number) => void;
  setSelectedRow: (i: number) => void;
  setSelectedDivergence: (i: number, row: number) => void;
  toggleFold: () => void;
  expandFold: (startRow: number) => void;
  expandAllFolds: () => void;
  toggleType: (t: StepType) => void;
  resetTypes: () => void;
  setQuery: (q: string) => void;
  dismissFailures: () => void;
  reset: () => void;
}

export const useApp = create<AppState>((set, get) => ({
  traces: [],
  primary: null,
  secondary: null,
  compareView: 'trajectory',
  selectedStep: 0,
  selectedRow: 0,
  selectedDivergence: 0,
  foldIdentical: true,
  expandedFolds: new Set(),
  typeFilter: new Set(STEP_TYPES),
  query: '',
  failures: [],

  setCompareView: (v) => set({ compareView: v }),

  load: (files) => {
    const state = get();
    const added: LoadedTrace[] = [];
    const failures: ImportFailure[] = [];
    const taken = new Set(state.traces.map((t) => t.key));

    for (const { fileName, raw } of files) {
      const result = importTrace(raw);
      if (!result.ok) {
        failures.push({ fileName, issues: result.issues });
        continue;
      }
      let key = result.trace.id;
      let n = 2;
      while (taken.has(key)) key = `${result.trace.id}#${n++}`;
      taken.add(key);
      added.push({
        key,
        fileName,
        normalized: normalize(result.trace),
        warnings: result.warnings,
      });
    }

    if (added.length === 0) {
      set({ failures });
      return;
    }

    const traces = [...state.traces, ...added];
    // Two traces dropped at once with nothing loaded is the compare case —
    // the fastest path to the interaction the product exists for.
    const primary = state.primary ?? added[0].key;
    const secondary =
      state.secondary ?? (state.primary === null && added.length > 1 ? added[1].key : state.secondary);

    set({
      traces,
      primary,
      secondary,
      failures,
      selectedStep: 0,
      selectedRow: 0,
      selectedDivergence: 0,
      expandedFolds: new Set(),
    });
  },

  /** Click cycles a trace through: unassigned → A → B → unassigned. */
  assign: (key) => {
    const { primary, secondary } = get();
    if (key === primary) {
      set({ primary: secondary, secondary: null, selectedRow: 0, selectedStep: 0, selectedDivergence: 0 });
    } else if (key === secondary) {
      set({ secondary: null, selectedRow: 0, selectedStep: 0, selectedDivergence: 0 });
    } else if (primary === null) {
      set({ primary: key, selectedStep: 0 });
    } else {
      set({ secondary: key, selectedRow: 0, selectedDivergence: 0, expandedFolds: new Set() });
    }
  },

  clearSecondary: () => set({ secondary: null, selectedRow: 0, selectedDivergence: 0 }),
  setSelectedStep: (i) => set({ selectedStep: i }),
  setSelectedRow: (i) => set({ selectedRow: i }),
  setSelectedDivergence: (i, row) => set({ selectedDivergence: i, selectedRow: row }),
  toggleFold: () => set((s) => ({ foldIdentical: !s.foldIdentical, expandedFolds: new Set() })),
  expandFold: (startRow) =>
    set((s) => ({ expandedFolds: new Set(s.expandedFolds).add(startRow) })),
  expandAllFolds: () => set({ foldIdentical: false }),

  toggleType: (t) =>
    set((s) => {
      const next = new Set(s.typeFilter);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return { typeFilter: next };
    }),
  resetTypes: () => set({ typeFilter: new Set(STEP_TYPES) }),
  setQuery: (q) => set({ query: q }),
  dismissFailures: () => set({ failures: [] }),
  reset: () =>
    set({
      traces: [],
      primary: null,
      secondary: null,
      selectedStep: 0,
      selectedRow: 0,
      selectedDivergence: 0,
      expandedFolds: new Set(),
      failures: [],
      query: '',
    }),
}));

export function traceByKey(traces: LoadedTrace[], key: string | null): LoadedTrace | undefined {
  return key ? traces.find((t) => t.key === key) : undefined;
}
