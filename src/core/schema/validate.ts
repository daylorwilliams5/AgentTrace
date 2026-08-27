import { z } from 'zod';
import { SCHEMA_ID, type Trace } from './types';

/**
 * Import validation. The goal is a path-precise, human-readable error —
 * "step 41 (id=s41): tool_result.status invalid enum value" is the
 * difference between a usable tool and a broken one.
 *
 * Permissiveness is deliberate: unknown keys are preserved, not stripped, so a
 * producer's extra fields survive into `meta`-adjacent inspection and the raw
 * JSON escape hatch stays faithful to the file on disk.
 */

const timestamp = z.union([z.number(), z.string()]);

const base = {
  id: z.string().min(1),
  t: timestamp.optional(),
  dur: z.number().optional(),
  label: z.string().optional(),
  parent: z.string().optional(),
  attempt: z.number().int().optional(),
  tags: z.array(z.string()).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
};

const modelStep = z.looseObject({
  ...base,
  type: z.literal('model'),
  model: z.string().optional(),
  output: z.string(),
  analysis: z.string().optional(),
  stopReason: z.string().optional(),
  tokens: z.looseObject({ in: z.number().optional(), out: z.number().optional() }).optional(),
});

const toolCallStep = z.looseObject({
  ...base,
  type: z.literal('tool_call'),
  callId: z.string().min(1),
  name: z.string().min(1),
  args: z.unknown().optional(),
});

const toolResultStep = z.looseObject({
  ...base,
  type: z.literal('tool_result'),
  callId: z.string().min(1),
  name: z.string().optional(),
  // Tri-state preferred; the legacy boolean is still accepted. Neither present
  // means the producer did not record status, which is `unknown`, not success.
  status: z.enum(['success', 'failure', 'unknown']).optional(),
  ok: z.boolean().optional(),
  result: z.unknown().optional(),
  error: z.looseObject({ kind: z.string().optional(), message: z.string() }).optional(),
});

const stateStep = z.looseObject({
  ...base,
  type: z.literal('state'),
  changes: z.array(
    z.looseObject({
      path: z.string().min(1),
      before: z.unknown().optional(),
      after: z.unknown().optional(),
      op: z.enum(['set', 'add', 'remove']).optional(),
    }),
  ),
});

const errorStep = z.looseObject({
  ...base,
  type: z.literal('error'),
  kind: z.string().optional(),
  message: z.string(),
  stack: z.string().optional(),
  recoverable: z.boolean().optional(),
  ofStep: z.string().optional(),
});

const retryStep = z.looseObject({
  ...base,
  type: z.literal('retry'),
  ofStep: z.string().optional(),
  attempt: z.number().int(),
  reason: z.string().optional(),
  backoffMs: z.number().optional(),
});

const stopStep = z.looseObject({
  ...base,
  type: z.literal('stop'),
  reason: z.enum(['goal_met', 'max_steps', 'error', 'user', 'timeout', 'unknown']),
  detail: z.string().optional(),
});

export const stepSchema = z.discriminatedUnion('type', [
  modelStep,
  toolCallStep,
  toolResultStep,
  stateStep,
  errorStep,
  retryStep,
  stopStep,
]);

export const traceSchema = z.looseObject({
  schema: z.literal(SCHEMA_ID),
  id: z.string().min(1),
  name: z.string().optional(),
  task: z.string().optional(),
  agent: z
    .looseObject({
      name: z.string().optional(),
      version: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
  startedAt: timestamp.optional(),
  endedAt: timestamp.optional(),
  status: z.enum(['success', 'failure', 'partial', 'unknown']).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  steps: z.array(stepSchema),
});

export interface ValidationIssue {
  /** Human-readable location, e.g. "steps[41] (id=s41)". */
  where: string;
  path: string;
  message: string;
}

export type ValidateResult =
  | { ok: true; trace: Trace; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };

export function validateTrace(raw: unknown): ValidateResult {
  const parsed = traceSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => toIssue(i, raw)) };
  }
  const trace = parsed.data as unknown as Trace;
  return { ok: true, trace, warnings: semanticWarnings(trace) };
}

function toIssue(issue: z.core.$ZodIssue, raw: unknown): ValidationIssue {
  const path = issue.path.map(String).join('.') || '(root)';
  let where = path;
  if (issue.path[0] === 'steps' && typeof issue.path[1] === 'number') {
    const idx = issue.path[1];
    const step = (raw as { steps?: unknown[] })?.steps?.[idx] as { id?: string } | undefined;
    where = `steps[${idx}]${step?.id ? ` (id=${step.id})` : ''}`;
  }
  return { where, path, message: issue.message };
}

/**
 * Non-fatal problems. These never block an import — the trace still renders —
 * but they degrade specific features, so the user is told rather than left to
 * wonder why a result shows no tool name.
 */
function semanticWarnings(trace: Trace): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const ids = new Set<string>();
  const callIds = new Map<string, number>();

  trace.steps.forEach((s, i) => {
    if (ids.has(s.id)) {
      out.push({
        where: `steps[${i}] (id=${s.id})`,
        path: `steps.${i}.id`,
        message: `duplicate step id "${s.id}"; references to this id (parent, ofStep) are ambiguous`,
      });
    }
    ids.add(s.id);
    if (s.type === 'tool_call') callIds.set(s.callId, i);
  });

  trace.steps.forEach((s, i) => {
    if (s.type === 'tool_result' && !callIds.has(s.callId)) {
      out.push({
        where: `steps[${i}] (id=${s.id})`,
        path: `steps.${i}.callId`,
        message: `tool_result references unknown callId "${s.callId}"; tool name cannot be resolved`,
      });
    }
    if (s.parent && !ids.has(s.parent)) {
      out.push({
        where: `steps[${i}] (id=${s.id})`,
        path: `steps.${i}.parent`,
        message: `parent "${s.parent}" is not a step in this trace; nesting depth cannot be derived from it`,
      });
    }
  });

  return out;
}
