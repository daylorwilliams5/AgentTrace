/**
 * Word-level LCS diff for model output. Used by the inspector to render an
 * inline text diff; kept in core/ so it is testable without a DOM.
 *
 * Tokenization preserves whitespace as its own tokens so the reconstruction is
 * lossless — the diff must never silently reflow the model's output.
 */

export type WordOp = 'same' | 'removed' | 'added';

export interface WordSpan {
  op: WordOp;
  text: string;
}

export function wordDiff(a: string, b: string): WordSpan[] {
  const ta = tokenizeWords(a);
  const tb = tokenizeWords(b);

  const n = ta.length;
  const m = tb.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        ta[i] === tb[j]
          ? dp[(i + 1) * w + (j + 1)] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)]);
    }
  }

  const out: WordSpan[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ta[i] === tb[j]) {
      push(out, 'same', ta[i]);
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
      push(out, 'removed', ta[i++]);
    } else {
      push(out, 'added', tb[j++]);
    }
  }
  while (i < n) push(out, 'removed', ta[i++]);
  while (j < m) push(out, 'added', tb[j++]);

  return out;
}

function push(out: WordSpan[], op: WordOp, text: string): void {
  const last = out[out.length - 1];
  if (last && last.op === op) last.text += text;
  else out.push({ op, text });
}

/** Words and whitespace runs, kept as separate tokens. */
export function tokenizeWords(s: string): string[] {
  return s.match(/\s+|[^\s]+/g) ?? [];
}
