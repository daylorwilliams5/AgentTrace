import { blocksOf, isAssistant, type CCBlock, type CCRecord } from './records';

/**
 * THE LOAD-BEARING PIECE.
 *
 * Claude Code writes ONE JSONL RECORD PER CONTENT BLOCK, and every record of a
 * single API turn repeats the same `message.id`, `usage` and `stop_reason`.
 * Measured on one 749-record session: 260 assistant records → 185 actual turns,
 * 75 of them split.
 *
 *   line 19  message.id=…7va3xL  [thinking]  stop_reason=tool_use
 *   line 20  message.id=…7va3xL  [tool_use]  stop_reason=tool_use   ← same turn
 *
 * Treating one record as one step would invent ~40% more model steps than the
 * agent actually took. That is not a display bug — it is a fabricated trace.
 */

export interface Turn {
  /** `message.id`, or a synthesized key when absent. */
  id: string;
  /** Index of the FIRST record of the turn, for ordering against user records. */
  at: number;
  records: CCRecord[];
  blocks: CCBlock[];
  model?: string;
  stopReason?: string;
  usage?: { in?: number; out?: number };
  timestamp?: string;
  /** True when any record of the turn was flagged as an API error. */
  apiError: boolean;
}

export function groupTurns(records: CCRecord[]): Turn[] {
  const byId = new Map<string, Turn>();
  const order: Turn[] = [];

  records.forEach((r, i) => {
    if (!isAssistant(r)) return;
    // A turn with no message.id cannot be grouped; treat it as its own turn
    // rather than merging unrelated records under a shared falsy key.
    const key = r.message?.id ?? `__nokey_${i}`;

    let turn = byId.get(key);
    if (!turn) {
      turn = {
        id: key,
        at: i,
        records: [],
        blocks: [],
        model: r.message?.model,
        stopReason: r.message?.stop_reason ?? undefined,
        usage: {
          in: r.message?.usage?.input_tokens,
          out: r.message?.usage?.output_tokens,
        },
        timestamp: r.timestamp,
        apiError: false,
      };
      byId.set(key, turn);
      order.push(turn);
    }
    turn.records.push(r);
    turn.blocks.push(...blocksOf(r));
    if (r.isApiErrorMessage) turn.apiError = true;
    // stop_reason is duplicated across splits; the last non-null wins so a
    // turn whose final record carries the reason is still reported correctly.
    if (r.message?.stop_reason) turn.stopReason = r.message.stop_reason;
  });

  return order;
}

/** Turns are keyed by record index so tool results can be interleaved in file order. */
export function turnStartIndex(turns: Turn[]): Map<number, Turn> {
  const m = new Map<number, Turn>();
  for (const t of turns) m.set(t.at, t);
  return m;
}
