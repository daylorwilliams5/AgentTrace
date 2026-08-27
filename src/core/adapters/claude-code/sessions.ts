import { isHumanPrompt, type CCRecord } from './records';

/**
 * A Claude Code session is a CONVERSATION, not a run.
 *
 * One profiled session held 8 human prompts across 185 turns — that is 8 runs.
 * agenttrace/v1 models one trace as one task, so a session is split at each
 * human turn: everything from a prompt up to (not including) the next prompt is
 * one run, with `task` set to that prompt.
 *
 * Records before the first human prompt (session bootstrap, injected context)
 * belong to no run and are dropped.
 */

export interface Run {
  /** 0-based ordinal within the session. */
  index: number;
  records: CCRecord[];
}

export function splitRuns(records: CCRecord[]): Run[] {
  const starts: number[] = [];
  records.forEach((r, i) => {
    if (isHumanPrompt(r)) starts.push(i);
  });
  if (starts.length === 0) return records.length ? [{ index: 0, records }] : [];

  return starts.map((start, k) => ({
    index: k,
    records: records.slice(start, starts[k + 1] ?? records.length),
  }));
}
