/**
 * agenttrace/v1 — the native trace schema.
 *
 * Design rules (see docs/schema.md):
 *  - Flat step array. `parent` is a rendering hint, not structure.
 *  - Seven step types, no subtypes.
 *  - `tool_call` and `tool_result` are separate steps linked by `callId`.
 *  - Everything is optional except `id` and `type`. Real traces are ragged;
 *    a missing field must degrade the UI, never reject the import.
 */

export const SCHEMA_ID = 'agenttrace/v1' as const;

export type StepType =
  | 'model'
  | 'tool_call'
  | 'tool_result'
  | 'state'
  | 'error'
  | 'retry'
  | 'stop';

export const STEP_TYPES: readonly StepType[] = [
  'model',
  'tool_call',
  'tool_result',
  'state',
  'error',
  'retry',
  'stop',
] as const;

export interface StepBase {
  /** Unique within the trace. Required. */
  id: string;
  type: StepType;
  /** Epoch milliseconds or ISO-8601. */
  t?: number | string;
  /** Milliseconds. Presentational only — never affects divergence. */
  dur?: number;
  /** One-line row summary. Derived during normalization when absent. */
  label?: string;
  /** Step id of a logical parent (retry group, sub-run). Rendering hint only. */
  parent?: string;
  /** 0-indexed retry attempt. */
  attempt?: number;
  tags?: string[];
  /** Adapter passthrough. Never dropped, never compared. */
  meta?: Record<string, unknown>;
}

export interface ModelStep extends StepBase {
  type: 'model';
  model?: string;
  /** The model-visible output. This is the primary evidence for a model step. */
  output: string;
  /**
   * Optional auxiliary text a producer may attach (a provider-exposed analysis
   * block, a planner scratchpad, an author's note). The debugger never assumes
   * this exists and is fully usable without it. It participates in the
   * signature only when BOTH compared steps carry it.
   */
  analysis?: string;
  stopReason?: string;
  tokens?: { in?: number; out?: number };
}

export interface ToolCallStep extends StepBase {
  type: 'tool_call';
  /** Pairs with ToolResultStep.callId. Opaque; never compared across traces. */
  callId: string;
  name: string;
  args?: unknown;
}

export interface ToolResultStep extends StepBase {
  type: 'tool_result';
  callId: string;
  /** Resolved from the paired call during normalization when absent. */
  name?: string;
  ok: boolean;
  result?: unknown;
  error?: { kind?: string; message: string };
}

export interface StateChange {
  /** Dot/bracket path, e.g. "plan.steps[2].status". */
  path: string;
  before?: unknown;
  after?: unknown;
  op?: 'set' | 'add' | 'remove';
}

/**
 * Explicit deltas only. V1 does not derive changes from snapshots, and the
 * product is fully useful for producers that emit no state steps at all.
 */
export interface StateStep extends StepBase {
  type: 'state';
  changes: StateChange[];
}

export interface ErrorStep extends StepBase {
  type: 'error';
  kind?: string;
  message: string;
  stack?: string;
  recoverable?: boolean;
  /** Step this error is attributed to. */
  ofStep?: string;
}

export interface RetryStep extends StepBase {
  type: 'retry';
  ofStep?: string;
  attempt: number;
  reason?: string;
  backoffMs?: number;
}

export type StopReason =
  | 'goal_met'
  | 'max_steps'
  | 'error'
  | 'user'
  | 'timeout'
  | 'unknown';

export interface StopStep extends StepBase {
  type: 'stop';
  reason: StopReason;
  detail?: string;
}

export type Step =
  | ModelStep
  | ToolCallStep
  | ToolResultStep
  | StateStep
  | ErrorStep
  | RetryStep
  | StopStep;

export type TraceStatus = 'success' | 'failure' | 'partial' | 'unknown';

export interface Trace {
  schema: typeof SCHEMA_ID;
  id: string;
  name?: string;
  /** The goal/prompt. Shown in the header; used to sanity-check a comparison. */
  task?: string;
  agent?: { name?: string; version?: string; model?: string };
  startedAt?: number | string;
  endedAt?: number | string;
  status?: TraceStatus;
  meta?: Record<string, unknown>;
  steps: Step[];
}

// ---------------------------------------------------------------------------
// Normalized forms — produced by core/model/normalize.ts, consumed by the UI
// and by the diff. Derived fields only; the original Step is never mutated.
// ---------------------------------------------------------------------------

export interface NormalizedStep {
  step: Step;
  /** Position in the trace. */
  index: number;
  /** Coarse alignment key. */
  anchor: string;
  /** Fine content key. */
  signature: string;
  /** How many earlier steps in this trace share this anchor. */
  ordinal: number;
  /** Nesting depth derived from `parent`. Rendering hint. */
  depth: number;
  /** Milliseconds from trace start, when computable. */
  offsetMs?: number;
  /** Row summary — author-provided `label` or derived. */
  label: string;
  /** For tool_result: the index of its paired tool_call, and that call's args. */
  pairedIndex?: number;
  callArgs?: unknown;
  /** For tool_call: whether its paired result succeeded, when present. */
  resultOk?: boolean;
}

export interface NormalizedTrace {
  trace: Trace;
  steps: NormalizedStep[];
  stats: {
    total: number;
    byType: Record<StepType, number>;
    tools: number;
    errors: number;
    retries: number;
    wallMs?: number;
  };
}
