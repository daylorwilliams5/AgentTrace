import argDriftA from './arg-drift.a.json';
import argDriftB from './arg-drift.b.json';
import failureRecoveryA from './failure-recovery.a.json';
import failureRecoveryB from './failure-recovery.b.json';
import inconclusiveA from './inconclusive-retrieval.a.json';
import inconclusiveB from './inconclusive-retrieval.b.json';
import stopDecisionA from './stop-decision.a.json';
import stopDecisionB from './stop-decision.b.json';

/**
 * Hand-authored fixture pairs. All content is synthetic: invented customers,
 * `.test` / `.invalid` reserved domains, invented record ids. Nothing here is
 * derived from a real system or a real trace.
 *
 * Each pair isolates one divergence pattern, so a regression in alignment
 * shows up as a specific pair failing rather than as a vague overall drift.
 */
export interface FixturePair {
  key: string;
  title: string;
  /** What this pair is designed to exercise. */
  pattern: string;
  a: unknown;
  b: unknown;
}

export const FIXTURE_PAIRS: FixturePair[] = [
  {
    key: 'arg-drift',
    title: 'invoice lookup — wrong tool argument',
    pattern:
      'Identical plan, one wrong tool argument → empty result → retry → rate limit → failure. ' +
      'The runs never re-converge.',
    a: argDriftA,
    b: argDriftB,
  },
  {
    key: 'stop-decision',
    title: 'incident digest — different stopping decision',
    pattern:
      'A self-inserted verification detour, then a long identical region, then a different stop ' +
      'reason on otherwise identical work. Two separate divergences with a foldable gap between them.',
    a: stopDecisionA,
    b: stopDecisionB,
  },
  {
    key: 'failure-recovery',
    title: 'changelog post — tool failure, recovery vs. exhaustion',
    pattern:
      'Same transient 503 in both. A falls back to another tool and succeeds; B retries the same ' +
      'tool a third time and dies. Three repeated `fetch_page` anchors vs. two — the alignment ' +
      'stress case.',
    a: failureRecoveryA,
    b: failureRecoveryB,
  },
  {
    key: 'inconclusive-retrieval',
    title: 'address confirm — inconclusive search handled differently',
    pattern:
      'Identical ambiguous 3-hit search. A narrows and answers correctly; B takes the first hit and ' +
      'answers confidently with the wrong record. Both runs report status=success and stop=goal_met — ' +
      'the failure is invisible without the diff.',
    a: inconclusiveA,
    b: inconclusiveB,
  },
];

export function fixturePair(key: string): FixturePair {
  const found = FIXTURE_PAIRS.find((p) => p.key === key);
  if (!found) throw new Error(`Unknown fixture pair "${key}"`);
  return found;
}
