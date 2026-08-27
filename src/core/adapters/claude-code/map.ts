import { SCHEMA_ID, type Step, type ToolStatus, type Trace } from '../../schema/types';
import { groupTurns, type Turn } from './group';
import { redact, type RedactOptions } from './redact';
import {
  blocksOf,
  isHumanPrompt,
  type CCBlock,
  type CCRecord,
  type CCTextBlock,
  type CCThinkingBlock,
  type CCToolResultBlock,
  type CCToolUseBlock,
} from './records';

/**
 * Claude Code records → agenttrace/v1 steps.
 *
 * What this deliberately does NOT emit, because the format does not record it:
 *   RetryStep  — Claude Code has no retry concept.
 *   StateStep  — no state concept.
 *   StopStep   — `stop_reason` is the PER-TURN API reason, not a run-level
 *                stopping decision. There is no goal_met, no max_steps, no
 *                termination record. Inventing one would be a lie, so the
 *                trace ends where the transcript ends and `status` is
 *                `unknown`.
 */

export interface MapOptions extends RedactOptions {
  /** Trace id; the export CLI supplies session id + run ordinal. */
  id: string;
  name?: string;
}

export interface MapResult {
  trace: Trace;
  stats: {
    turns: number;
    assistantRecords: number;
    toolCalls: number;
    toolResults: number;
    /** Results whose success the transcript never stated. */
    okUnknown: number;
    okTrue: number;
    okFalse: number;
    /** tool_use blocks that never received a result (session ended mid-flight). */
    unansweredCalls: number;
  };
}

const isText = (b: CCBlock): b is CCTextBlock => b.type === 'text';
const isThinking = (b: CCBlock): b is CCThinkingBlock => b.type === 'thinking';
const isToolUse = (b: CCBlock): b is CCToolUseBlock => b.type === 'tool_use';
const isToolResult = (b: CCBlock): b is CCToolResultBlock => b.type === 'tool_result';

export function mapRecords(records: CCRecord[], o: MapOptions): MapResult {
  const turns = groupTurns(records);
  const turnAt = new Map<number, Turn>();
  for (const t of turns) turnAt.set(t.at, t);

  const steps: Step[] = [];
  const callTime = new Map<string, number>();
  const callName = new Map<string, string>();
  const answered = new Set<string>();
  let okUnknown = 0;
  let okTrue = 0;
  let okFalse = 0;
  let toolCalls = 0;
  let toolResults = 0;

  const ms = (t?: string) => (t ? Date.parse(t) : undefined);

  records.forEach((r, i) => {
    const turn = turnAt.get(i);
    if (turn) {
      emitTurn(turn, steps, o);
      for (const b of turn.blocks) {
        if (!isToolUse(b)) continue;
        toolCalls++;
        callTime.set(b.id, ms(turn.timestamp) ?? 0);
        callName.set(b.id, b.name);
        steps.push({
          id: `c:${b.id}`,
          type: 'tool_call',
          callId: b.id,
          name: b.name,
          args: redact(b.input, o),
          t: turn.timestamp,
        });
      }
      return;
    }

    if (r.type !== 'user') return;
    for (const b of blocksOf(r)) {
      if (!isToolResult(b)) continue;
      toolResults++;
      answered.add(b.tool_use_id);

      // ── the tri-state ─────────────────────────────────────────────────
      // `is_error` is present on only about half of all results. Absence is
      // NOT a success signal: a Bash command exiting non-zero still reports
      // `is_error: false`, and a result with no flag reports nothing at all.
      // We record exactly what the transcript said and never inspect the
      // result text to second-guess it — showing both facts is the point.
      const status: ToolStatus =
        b.is_error === true ? 'failure' : b.is_error === false ? 'success' : 'unknown';
      const failed = status === 'failure';
      if (status === 'unknown') okUnknown++;
      else if (failed) okFalse++;
      else okTrue++;

      const payload = r.toolUseResult !== undefined ? r.toolUseResult : b.content;
      const started = callTime.get(b.tool_use_id);
      const ended = ms(r.timestamp);

      steps.push({
        id: `r:${b.tool_use_id}`,
        type: 'tool_result',
        callId: b.tool_use_id,
        name: callName.get(b.tool_use_id),
        status,
        result: redact(payload, o),
        error: failed ? { kind: 'ToolError', message: asMessage(payload, o) } : undefined,
        t: r.timestamp,
        dur: started && ended && ended >= started ? ended - started : undefined,
      });

      if (failed) {
        steps.push({
          id: `e:${b.tool_use_id}`,
          type: 'error',
          kind: 'ToolError',
          message: asMessage(payload, o),
          ofStep: `c:${b.tool_use_id}`,
          t: r.timestamp,
        });
      }
    }
  });

  const times = records.map((r) => r.timestamp).filter(Boolean) as string[];
  const first = records.find((r) => r.type === 'assistant' || r.type === 'user');

  const trace: Trace = {
    schema: SCHEMA_ID,
    id: o.id,
    name: o.name ?? o.id,
    task: taskOf(records, o),
    agent: {
      name: 'claude-code',
      version: first?.version,
      model: turns.find((t) => t.model)?.model,
    },
    startedAt: times[0],
    endedAt: times[times.length - 1],
    // No stopping decision exists anywhere in the transcript. See the header.
    status: 'unknown',
    meta: {
      source: 'claude-code',
      sessionId: first?.sessionId,
      redaction: o.level,
    },
    steps,
  };

  const unansweredCalls = [...callName.keys()].filter((id) => !answered.has(id)).length;

  return {
    trace,
    stats: {
      turns: turns.length,
      assistantRecords: records.filter((r) => r.type === 'assistant').length,
      toolCalls,
      toolResults,
      okUnknown,
      okTrue,
      okFalse,
      unansweredCalls,
    },
  };
}

function emitTurn(turn: Turn, steps: Step[], o: RedactOptions): void {
  const output = turn.blocks.filter(isText).map((b) => b.text).join('\n').trim();
  const analysis = turn.blocks.filter(isThinking).map((b) => b.thinking ?? '').join('\n').trim();

  // A turn that is nothing but a tool_use has no visible output. Emitting an
  // empty model step would be honest but noisy; emitting nothing loses the
  // turn boundary. We keep it — the turn happened, and its stop_reason and
  // token cost are real.
  steps.push({
    id: `m:${turn.id}`,
    type: 'model',
    model: turn.model,
    output: redactStr(output, o),
    analysis: analysis ? redactStr(analysis, o) : undefined,
    stopReason: turn.stopReason,
    tokens: turn.usage?.in !== undefined || turn.usage?.out !== undefined ? turn.usage : undefined,
    t: turn.timestamp,
    // Durations on model steps would measure human reading time between turns,
    // not model latency. Omitted rather than reported misleadingly.
    ...(turn.apiError ? { tags: ['api-error'] } : {}),
  });
}

function redactStr(s: string, o: RedactOptions): string {
  return redact(s, o) as string;
}

function asMessage(payload: unknown, o: RedactOptions): string {
  const s = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return redactStr((s ?? '').slice(0, 400), o);
}

function taskOf(records: CCRecord[], o: RedactOptions): string | undefined {
  const p = records.find(isHumanPrompt);
  if (!p) return undefined;
  const c = p.message?.content;
  const text =
    typeof c === 'string'
      ? c
      : blocksOf(p)
          .filter(isText)
          .map((b) => b.text)
          .join('\n');
  return text ? redactStr(text.trim(), o) : undefined;
}
