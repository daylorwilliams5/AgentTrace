import type { StepType } from '../core/schema/types';

/**
 * ONE preference mechanism for every row preview.
 *
 * Both the paired-row preview (which ranks computed field diffs) and the
 * one-sided-row preview (which ranks a step's own payload leaves) go through
 * this module, so the two paths cannot drift apart.
 *
 * This is a declared convention about WHERE payloads live in common tool
 * schemas — the same category as the `stop.reason` lexicon. It ranks field
 * NAMES. It never reads a value, never parses content, and never infers whether
 * a call succeeded. Display only: signatures, alignment and divergence are
 * untouched by anything here.
 *
 * Without it, leaves are taken in sorted order, so a Bash result previews
 * `interrupted false` instead of its `stdout`, because `i` sorts before `s`.
 */

/** Ordered, best first. Matched segment-aligned against the end of a path. */
export const PREFERRED: Record<StepType, readonly string[]> = {
  tool_result: [
    'error.message',
    'error.kind',
    'stdout',
    'content',
    'result',
    'output',
    'text',
    'stderr',
    'matches',
    'numLines',
    'numFiles',
    'hits',
  ],
  tool_call: ['command', 'file_path', 'path', 'pattern', 'query', 'q', 'url', 'id'],
  state: ['after'],
  error: ['message'],
  retry: ['reason'],
  // A model row previews its derived label; a stop row's label already carries
  // the reason. Neither needs a payload field.
  model: [],
  stop: [],
};

/**
 * Bookkeeping that says nothing about what the tool did. Never preferred, but
 * still selectable as a last resort so a preview is never blank when the step
 * genuinely has nothing else.
 */
export const DEPRIORITIZED: ReadonlySet<string> = new Set([
  'interrupted',
  'isImage',
  'noOutputExpected',
  'userModified',
  'sandbox',
  'mode',
  'type',
  'description',
  'timeout',
  'run_in_background',
  'stack',
  'backoffMs',
]);

const LAST_RESORT = 1e6;

/** Strip array indices so `changes[0].after` ranks as `after`. */
function segments(path: string): string[] {
  return path.replace(/\[\d+\]/g, '').split('.').filter(Boolean);
}

function endsWithPreference(path: string, pref: string): boolean {
  const p = segments(path);
  const q = segments(pref);
  if (q.length > p.length) return false;
  return q.every((seg, i) => seg === p[p.length - q.length + i]);
}

/** Lower is better. Neutral for unknown names; last-resort for bookkeeping. */
export function previewRank(type: StepType, path: string): number {
  const prefs = PREFERRED[type] ?? [];
  for (let i = 0; i < prefs.length; i++) if (endsWithPreference(path, prefs[i])) return i;
  const leaf = segments(path).at(-1) ?? path;
  if (DEPRIORITIZED.has(leaf)) return LAST_RESORT;
  return prefs.length; // unknown schema: neutral, ahead of bookkeeping
}

/** Stable pick: best rank wins, original order breaks ties. */
function bestBy<T>(items: readonly T[], rank: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestRank = Infinity;
  items.forEach((item, i) => {
    const r = rank(item) * 1000 + i; // rank dominates; index only breaks ties
    if (r < bestRank) {
      bestRank = r;
      best = item;
    }
  });
  return best;
}

/** Rank computed field diffs (paired rows). */
export function pickPreviewField<T extends { path: string }>(
  type: StepType,
  fields: readonly T[],
): T | undefined {
  return bestBy(fields, (f) => previewRank(type, f.path));
}

/**
 * Rank a step's own payload leaves (one-sided rows).
 *
 * Empty and null leaves are skipped first — the existing fallback of "first
 * non-empty scalar leaf" is preserved for schemas this table does not know.
 */
export function pickPreviewLeaf(
  type: StepType,
  entries: ReadonlyArray<readonly [string, unknown]>,
): readonly [string, unknown] | undefined {
  const usable = entries.filter(([, v]) => v !== null && v !== undefined && v !== '');
  return bestBy(usable.length ? usable : entries, ([path]) => previewRank(type, path));
}
