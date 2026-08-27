import { toolStatusOf, type Trace } from '../../schema/types';
import type { ValidationIssue } from '../../schema/validate';
import type { TraceAdapter } from '../types';
import { mapRecords, type MapResult } from './map';
import { parseJsonl, type CCRecord } from './records';
import { splitRuns } from './sessions';
import type { RedactLevel } from './redact';

export { parseJsonl } from './records';
export { groupTurns } from './group';
export { splitRuns } from './sessions';
export { redact, scanSecrets, type RedactLevel, type SecretHit } from './redact';
export { mapRecords, type MapResult } from './map';

export interface ConvertOptions {
  id: string;
  name?: string;
  level?: RedactLevel;
  home?: string;
  /** Which run within the session. Defaults to the last one. */
  run?: number | 'last' | 'all';
}

/** Full pipeline: JSONL text → one or more agenttrace/v1 traces. */
export function convertTranscript(text: string, o: ConvertOptions): MapResult[] {
  const records = parseJsonl(text);
  const runs = splitRuns(records);
  const level = o.level ?? 'paths';

  const chosen =
    o.run === 'all'
      ? runs
      : o.run === undefined || o.run === 'last'
        ? runs.slice(-1)
        : runs.filter((r) => r.index === o.run);

  return chosen.map((r, k) =>
    mapRecords(r.records, {
      id: chosen.length > 1 ? `${o.id}#${r.index}` : o.id,
      name: o.name ?? (chosen.length > 1 ? `${o.id} run ${r.index}` : o.id),
      level,
      home: o.home,
      ...(k >= 0 ? {} : {}),
    }),
  );
}

/**
 * The registry adapter. Accepts either raw JSONL text or an already-parsed
 * record array, so the same code path serves the CLI and a future drag-and-drop
 * of a .jsonl file into the app.
 */
export const claudeCodeAdapter: TraceAdapter = {
  id: 'claude-code',
  name: 'Claude Code transcript (.jsonl)',

  detect(raw: unknown): number {
    const records = normalize(raw);
    if (!records || records.length === 0) return 0;
    const hasAssistant = records.some((r) => r.type === 'assistant' && r.message?.id);
    const hasSession = records.some((r) => typeof r.sessionId === 'string');
    if (hasAssistant && hasSession) return 0.9;
    if (hasAssistant) return 0.5;
    return 0;
  },

  parse(raw: unknown): Trace {
    const records = normalize(raw) ?? [];
    const runs = splitRuns(records);
    const last = runs[runs.length - 1];
    return mapRecords(last?.records ?? records, {
      id: records[0]?.sessionId ?? 'claude-code-session',
      name: last && runs.length > 1 ? `${records[0]?.sessionId ?? 'session'} · run ${last.index + 1}/${runs.length}` : undefined,
      level: 'paths',
      // No `os` in the browser: fold whatever home prefix the transcript's own
      // `cwd` reveals.
      home: inferHome(records),
    }).trace;
  },

  /**
   * What this conversion could not represent. Shown next to the trace so a
   * reader is never left to infer that a missing concept means "it didn't
   * happen" rather than "the source never recorded it".
   */
  limitations(trace: Trace, raw: unknown): ValidationIssue[] {
    const out: ValidationIssue[] = [];
    const records = normalize(raw) ?? [];
    const runs = splitRuns(records);

    if (runs.length > 1) {
      out.push({
        where: '(session)',
        path: 'steps',
        message: `session contains ${runs.length} prompts; imported the last one as a single run`,
      });
    }

    const results = trace.steps.filter((s) => s.type === 'tool_result');
    const unknown = results.filter((s) => toolStatusOf(s) === 'unknown').length;
    if (unknown > 0) {
      out.push({
        where: '(tool results)',
        path: 'steps[].status',
        message:
          `${unknown} of ${results.length} tool results have status "unknown" — ` +
          `Claude Code omits is_error on these, so success was never reported`,
      });
    }

    out.push({
      where: '(run outcome)',
      path: 'status',
      message:
        'Claude Code transcripts record no stopping decision, so there is no stop step and run status is "unknown"',
    });
    out.push({
      where: '(step types)',
      path: 'steps',
      message: 'Claude Code records no retries and no state changes; those step types are absent, not empty',
    });

    const calls = new Set(trace.steps.filter((s) => s.type === 'tool_call').map((s) => s.callId));
    for (const s of trace.steps) if (s.type === 'tool_result') calls.delete(s.callId);
    if (calls.size > 0) {
      out.push({
        where: '(tool calls)',
        path: 'steps',
        message: `${calls.size} tool call(s) never received a result — the session ended mid-flight`,
      });
    }

    return out;
  },
};

/** Recover the home prefix from a transcript's own `cwd`, without `os`. */
export function inferHome(records: CCRecord[]): string | undefined {
  for (const r of records) {
    const m = /^(\/(?:Users|home)\/[^/]+)/.exec(r.cwd ?? '');
    if (m) return m[1];
  }
  return undefined;
}

function normalize(raw: unknown): CCRecord[] | undefined {
  if (typeof raw === 'string') return parseJsonl(raw);
  if (Array.isArray(raw)) return raw as CCRecord[];
  return undefined;
}
