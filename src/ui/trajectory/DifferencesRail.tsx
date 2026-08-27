import type { Divergence } from '../../core/diff/divergence';
import { wordDiff } from '../../core/diff/words';
import { describeDivergence, isReplacement } from './labels';

/**
 * The differences list. One item per difference region — regions are never
 * decomposed further. Every line is a count, a position, or a producer string;
 * nothing here is generated or ranked.
 */
export function DifferencesRail({
  divs,
  selected,
  onSelect,
}: {
  divs: Divergence[];
  selected: number;
  onSelect: (i: number) => void;
}) {
  // Nothing to navigate with a single difference: the rail steps back so it
  // does not compete with the trajectory for attention.
  const quiet = divs.length < 2;

  return (
    <div className={`tv-rail${quiet ? ' tv-rail--quiet' : ''}`}>
      <div className="tv-rail__head">
        <span>differences</span>
        <span>{divs.length}</span>
      </div>

      {divs.length === 0 && <div className="tv-rail__empty">Both runs behaved identically.</div>}

      {divs.map((d) => {
        const copy = describeDivergence(d, outputWasReplaced(d));
        return (
          <button
            key={d.index}
            className={`tv-rail__item${d.index === selected ? ' tv-rail__item--sel' : ''}`}
            onClick={() => onSelect(d.index)}
          >
            <span className="tv-rail__n">{String(d.index + 1).padStart(2, '0')}</span>
            <span className="tv-rail__body">
              <span className="tv-rail__title">{copy.title}</span>
              <span className="tv-rail__sub">{copy.sub}</span>
              {copy.extent && <span className="tv-rail__extent">{copy.extent}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Reuses the shipped edit/replace threshold so the rail and inspector agree. */
function outputWasReplaced(d: Divergence): boolean {
  const head = d.rows[0];
  if (head.kind !== 'changed') return false;
  const a = head.a?.step;
  const b = head.b?.step;
  if (a?.type !== 'model' || b?.type !== 'model') return false;
  const same = wordDiff(a.output, b.output)
    .filter((s) => s.op === 'same')
    .reduce((n, s) => n + s.text.trim().length, 0);
  return isReplacement(a.output, b.output, same);
}
