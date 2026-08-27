import { useState } from 'react';
import type { AlignedRow } from '../../core/diff/align';
import type { NormalizedStep, NormalizedTrace } from '../../core/schema/types';
import { fmtValue, fmtValueShort } from '../format';
import { MARK_GLYPH, salientField, shortPath, stepLabel } from './labels';
import {
  GROUP_COMPRESS_KEEP,
  GROUP_COMPRESS_OVER,
  heroFields,
  type DifferenceSegment,
  type Group,
} from './segments';

/* ── geometry ────────────────────────────────────────────────────────────── */

/** The only drawn metaphor: one line becoming two, and two becoming one. */
export function Fork({ dir }: { dir: 'split' | 'merge' }) {
  const d =
    dir === 'split'
      ? ['M29 0 V6 Q29 20 0.5 20', 'M29 0 V6 Q29 20 57.5 20']
      : ['M0.5 0 Q29 0 29 14 V20', 'M57.5 0 Q29 0 29 14 V20'];
  return (
    <div className="tv-lanes">
      <div />
      <div className="tv-chan tv-chan--open">
        <svg width="58" height="20" viewBox="0 0 58 20" aria-hidden="true">
          {d.map((p, i) => (
            <path key={i} d={p} fill="none" stroke="var(--line-strong)" strokeWidth="1" />
          ))}
        </svg>
      </div>
      <div />
    </div>
  );
}

/* ── rows ────────────────────────────────────────────────────────────────── */

function Mark({ mark }: { mark: keyof typeof MARK_GLYPH }) {
  if (mark === 'none') return null;
  return <span className={`tv-mark tv-mark--${mark}`}>{MARK_GLYPH[mark]}</span>;
}

/** The one value worth showing beside a compact paired row. */
function laneValue(row: AlignedRow, side: 'a' | 'b'): { k?: string; v: string } | undefined {
  const s = row[side];
  if (!s) return undefined;
  if (s.step.type === 'model') return { v: s.label };
  const f = salientField(row);
  if (!f) return undefined;
  const v = side === 'a' ? f.before : f.after;
  if (v === undefined) return undefined;
  // A state step's label already carries the path ("set customer.id"), so the
  // leaf key ("after") would only add noise.
  const k = s.step.type === 'state' ? undefined : shortPath(f.path);
  return { k, v: fmtValueShort(v, 40) };
}

function LaneStep({
  s,
  steps,
  value,
}: {
  s: NormalizedStep;
  steps: NormalizedStep[];
  value?: { k?: string; v: string };
}) {
  const l = stepLabel(s, steps);
  return (
    <div className="tv-lanestep">
      <div className="tv-lanestep__label">
        <Mark mark={l.mark} />
        <span>{l.text}</span>
      </div>
      {l.sub && <div className="tv-lanestep__sub">{l.sub}</div>}
      {value && (
        <div className="tv-lanestep__val">
          {value.k && <span className="tv-lanestep__k">{value.k}</span>}
          <span>{value.v}</span>
        </div>
      )}
    </div>
  );
}

/** A paired row: same operation on both sides, different content. */
function PairedRow({
  row,
  A,
  B,
  selected,
  onSelect,
  rowRef,
}: {
  row: AlignedRow;
  A: NormalizedTrace;
  B: NormalizedTrace;
  selected: boolean;
  onSelect: () => void;
  rowRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={rowRef}
      className={`tv-lanes tv-lanes--row${selected ? ' tv-lanes--sel' : ''}`}
      onClick={onSelect}
    >
      <div className="tv-lane tv-lane--a">
        {row.a && <LaneStep s={row.a} steps={A.steps} value={laneValue(row, 'a')} />}
      </div>
      <div className="tv-chan" />
      <div className="tv-lane tv-lane--b">
        {row.b && <LaneStep s={row.b} steps={B.steps} value={laneValue(row, 'b')} />}
      </div>
    </div>
  );
}

/**
 * A run of steps present in only one run.
 *
 * Absence is harder to perceive than a changed value, so the band is labelled
 * even though the empty lane opposite already shows it.
 */
function SoloBand({
  side,
  rows,
  A,
  B,
  selectedRow,
  onSelect,
  rowRef,
}: {
  side: 'A' | 'B';
  rows: AlignedRow[];
  A: NormalizedTrace;
  B: NormalizedTrace;
  selectedRow: number;
  onSelect: (i: number) => void;
  rowRef: (i: number) => (el: HTMLDivElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const long = rows.length > GROUP_COMPRESS_OVER && !open;
  const shown = long ? rows.slice(0, GROUP_COMPRESS_KEEP) : rows;
  const hidden = rows.length - shown.length;
  const steps = side === 'A' ? A.steps : B.steps;

  return (
    <>
      <div className="tv-lanes tv-lanes--band">
        <div className="tv-lane">{side === 'A' && <BandLabel side={side} n={rows.length} />}</div>
        <div className="tv-chan" />
        <div className="tv-lane">{side === 'B' && <BandLabel side={side} n={rows.length} />}</div>
      </div>

      {shown.map((r) => {
        const s = side === 'A' ? r.a : r.b;
        return (
          <div
            key={r.index}
            ref={rowRef(r.index)}
            className={`tv-lanes tv-lanes--row${
              r.index === selectedRow ? ` tv-lanes--sel${side}` : ''
            }`}
            onClick={() => onSelect(r.index)}
          >
            <div className="tv-lane tv-lane--a">
              {side === 'A' && s && <LaneStep s={s} steps={steps} />}
            </div>
            <div className="tv-chan" />
            <div className="tv-lane tv-lane--b">
              {side === 'B' && s && <LaneStep s={s} steps={steps} />}
            </div>
          </div>
        );
      })}

      {hidden > 0 && (
        <div className="tv-lanes tv-lanes--band">
          <div className="tv-lane">
            {side === 'A' && (
              <button className="tv-more" onClick={() => setOpen(true)}>
                {hidden} more ⌄
              </button>
            )}
          </div>
          <div className="tv-chan" />
          <div className="tv-lane">
            {side === 'B' && (
              <button className="tv-more" onClick={() => setOpen(true)}>
                {hidden} more ⌄
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function BandLabel({ side, n }: { side: 'A' | 'B'; n: number }) {
  return (
    <div className={`tv-bandlabel tv-bandlabel--${side.toLowerCase()}`}>
      only in run {side} · {n} step{n === 1 ? '' : 's'}
    </div>
  );
}

/* ── the difference point ────────────────────────────────────────────────── */

function HeroFieldTable({ row }: { row: AlignedRow }) {
  const fields = heroFields(row.a, row.b);
  if (fields.length === 0) return null;
  // One grid for the whole table, rows via `display: contents`, so keys and
  // values line up in columns on both sides of the channel.
  return (
    <div className="tv-ft">
      {fields.map((f) => {
        const c = `tv-ft__cell tv-ft__cell--${f.op}`;
        return (
          <div key={f.path} className="tv-ft__row">
            <span className={`${c} tv-ft__ka`}>{f.op === 'onlyB' ? '' : shortPath(f.path)}</span>
            <span className={`${c} tv-ft__va`}>{f.op === 'onlyB' ? '' : fmtValueShort(f.a, 44)}</span>
            <span className="tv-ft__chan" />
            <span className={`${c} tv-ft__kb`}>{f.op === 'onlyA' ? '' : shortPath(f.path)}</span>
            <span className={`${c} tv-ft__vb`}>{f.op === 'onlyA' ? '' : fmtValueShort(f.b, 44)}</span>
          </div>
        );
      })}
    </div>
  );
}

function HeroText({ a, b }: { a?: string; b?: string }) {
  return (
    <div className="tv-lanes tv-lanes--hero">
      <div className="tv-lane tv-lane--a">
        <p className="tv-herotext">{a}</p>
      </div>
      <div className="tv-chan" />
      <div className="tv-lane tv-lane--b">
        <p className="tv-herotext">{b}</p>
      </div>
    </div>
  );
}

function Hero({
  seg,
  A,
  B,
  selectedRow,
  onSelect,
  rowRef,
}: {
  seg: DifferenceSegment;
  A: NormalizedTrace;
  B: NormalizedTrace;
  selectedRow: number;
  onSelect: (i: number) => void;
  rowRef: (i: number) => (el: HTMLDivElement | null) => void;
}) {
  if (seg.heroKind === 'solo') {
    const side = seg.heroSide!;
    const steps = side === 'A' ? A.steps : B.steps;
    return (
      <>
        <div className="tv-lanes tv-lanes--band">
          <div className="tv-lane">{side === 'A' && <BandLabel side={side} n={seg.hero.length} />}</div>
          <div className="tv-chan" />
          <div className="tv-lane">{side === 'B' && <BandLabel side={side} n={seg.hero.length} />}</div>
        </div>
        {seg.hero.map((r) => {
          const s = side === 'A' ? r.a : r.b;
          return (
            <div
              key={r.index}
              ref={rowRef(r.index)}
              className={`tv-lanes tv-lanes--heroSolo${
                r.index === selectedRow ? ` tv-lanes--sel${side}` : ''
              }`}
              onClick={() => onSelect(r.index)}
            >
              <div className="tv-lane tv-lane--a">
                {side === 'A' && s && <HeroSoloStep s={s} steps={steps} />}
              </div>
              <div className="tv-chan" />
              <div className="tv-lane tv-lane--b">
                {side === 'B' && s && <HeroSoloStep s={s} steps={steps} />}
              </div>
            </div>
          );
        })}
      </>
    );
  }

  const row = seg.hero[0];
  const type = (row.a ?? row.b)?.step.type;
  const la = row.a ? stepLabel(row.a, A.steps) : undefined;
  const lb = row.b ? stepLabel(row.b, B.steps) : undefined;

  return (
    <div
      ref={rowRef(row.index)}
      className={`tv-hero${row.index === selectedRow ? ' tv-hero--sel' : ''}`}
      onClick={() => onSelect(row.index)}
    >
      <div className="tv-lanes tv-lanes--herohead">
        <div className="tv-lane tv-lane--a">
          <div className="tv-hero__run">run a</div>
          <div className="tv-hero__op">
            {la && <Mark mark={la.mark} />}
            {la?.text}
          </div>
        </div>
        <div className="tv-chan" />
        <div className="tv-lane tv-lane--b">
          <div className="tv-hero__run">run b</div>
          <div className="tv-hero__op">
            {lb && <Mark mark={lb.mark} />}
            {lb?.text}
          </div>
        </div>
      </div>

      {type === 'model' ? (
        <HeroText
          a={row.a?.step.type === 'model' ? row.a.step.output : undefined}
          b={row.b?.step.type === 'model' ? row.b.step.output : undefined}
        />
      ) : (
        <HeroFieldTable row={row} />
      )}
    </div>
  );
}

function HeroSoloStep({ s, steps }: { s: NormalizedStep; steps: NormalizedStep[] }) {
  const l = stepLabel(s, steps);
  const args = s.step.type === 'tool_call' ? s.step.args : undefined;
  return (
    <div className="tv-lanestep tv-lanestep--hero">
      <div className="tv-lanestep__label">
        <Mark mark={l.mark} />
        <span>{l.text}</span>
      </div>
      {l.sub && <div className="tv-lanestep__sub">{l.sub}</div>}
      {args !== undefined && args !== null && typeof args === 'object' && (
        <div className="tv-args">
          {Object.entries(args as Record<string, unknown>)
            .slice(0, 5)
            .map(([k, v]) => (
              <div key={k} className="tv-args__row">
                <span className="tv-args__k">{k}</span>
                <span className="tv-args__v">{fmtValue(v)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/* ── the region ──────────────────────────────────────────────────────────── */

export function DifferenceRegion({
  seg,
  index,
  isFirst,
  A,
  B,
  selectedRow,
  onSelect,
  rowRef,
}: {
  seg: DifferenceSegment;
  index: number;
  isFirst: boolean;
  A: NormalizedTrace;
  B: NormalizedTrace;
  selectedRow: number;
  onSelect: (i: number) => void;
  rowRef: (i: number) => (el: HTMLDivElement | null) => void;
}) {
  const stepNo = (seg.hero[0].a ?? seg.hero[0].b)!.index + 1;
  return (
    <section className="tv-region">
      <div className="tv-region__label">
        <span className="tv-region__title">
          {isFirst ? 'First difference' : `Difference ${index + 1}`}
        </span>
        <span className="tv-region__rule" />
        <span className="tv-region__step">step {stepNo}</span>
      </div>

      <div className={`tv-region__body${seg.merges ? '' : ' tv-region__body--open'}`}>
        <Fork dir="split" />

        <Hero
        seg={seg}
          A={A}
          B={B}
          selectedRow={selectedRow}
          onSelect={onSelect}
          rowRef={rowRef}
        />

        {seg.groups.map((g: Group, i) =>
        g.kind === 'paired' ? (
          <div key={i}>
            {g.rows.map((r) => (
              <PairedRow
                key={r.index}
                row={r}
                A={A}
                B={B}
                selected={r.index === selectedRow}
                onSelect={() => onSelect(r.index)}
                rowRef={rowRef(r.index)}
              />
            ))}
          </div>
        ) : (
          <SoloBand
            key={i}
            side={g.side}
            rows={g.rows}
            A={A}
            B={B}
            selectedRow={selectedRow}
            onSelect={onSelect}
            rowRef={rowRef}
          />
        ),
      )}

        {seg.merges ? <Fork dir="merge" /> : <div className="tv-open" />}
      </div>
    </section>
  );
}
