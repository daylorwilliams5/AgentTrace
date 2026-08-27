/**
 * Human-readable alignment report for every fixture pair.
 *
 *   npm run report
 *
 * This is the terminal proof that the diff behaves before any UI exists: it
 * prints the aligned rows, the fold regions, the divergence list, and the
 * field-level diff at the first divergence — the same information the compare
 * view will render.
 */
import { align, type AlignedRow, type Alignment } from '../src/core/diff/align';
import { divergences } from '../src/core/diff/divergence';
import { importTrace } from '../src/core/adapters/registry';
import { normalize } from '../src/core/model/normalize';
import { FIXTURE_PAIRS } from '../src/fixtures';
import type { NormalizedTrace } from '../src/core/schema/types';

const GLYPH = { identical: '=', changed: '~', onlyA: '−', onlyB: '+' } as const;
const FOLD_MIN = 3;

function load(raw: unknown, which: string): NormalizedTrace {
  const r = importTrace(raw);
  if (!r.ok) throw new Error(`${which} failed to import: ${JSON.stringify(r.issues, null, 2)}`);
  return normalize(r.trace);
}

function cell(row: AlignedRow, side: 'a' | 'b'): string {
  const s = row[side];
  if (!s) return '';
  const type = s.step.type.toUpperCase().padEnd(11);
  return `${String(s.index).padStart(2)} ${type} ${s.label}`;
}

function pad(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n);
}

function printAlignment(al: Alignment): void {
  const W = 46;
  console.log(`  ${pad('RUN A', W)} ${pad('RUN B', W)}`);
  console.log(`  ${'─'.repeat(W)}   ${'─'.repeat(W)}`);

  let i = 0;
  while (i < al.rows.length) {
    // Fold runs of identical rows, exactly as the compare view will.
    if (al.rows[i].kind === 'identical') {
      let j = i;
      while (j < al.rows.length && al.rows[j].kind === 'identical') j++;
      if (j - i >= FOLD_MIN) {
        const label = `⋯ ${j - i} identical steps ⋯`;
        console.log(`  ${pad(label, W)} = ${pad(label, W)}`);
        i = j;
        continue;
      }
    }
    const r = al.rows[i];
    console.log(`  ${pad(cell(r, 'a'), W)} ${GLYPH[r.kind]} ${pad(cell(r, 'b'), W)}`);
    i++;
  }
}

function fmt(v: unknown): string {
  const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v ?? null);
  return s.length > 52 ? `${s.slice(0, 51)}…` : s;
}

let failures = 0;

for (const pair of FIXTURE_PAIRS) {
  const a = load(pair.a, `${pair.key}.a`);
  const b = load(pair.b, `${pair.key}.b`);
  const al = align(a, b);
  const divs = divergences(al);

  console.log(`\n${'═'.repeat(96)}`);
  console.log(`${pair.key.toUpperCase()}  —  ${pair.title}`);
  console.log(`${'═'.repeat(96)}`);
  console.log(`  task     ${a.trace.task}`);
  console.log(
    `  A        ${a.trace.name}  ${a.stats.total} steps  status=${a.trace.status}  ` +
      `errors=${a.stats.errors}  retries=${a.stats.retries}`,
  );
  console.log(
    `  B        ${b.trace.name}  ${b.stats.total} steps  status=${b.trace.status}  ` +
      `errors=${b.stats.errors}  retries=${b.stats.retries}`,
  );
  console.log();

  printAlignment(al);

  console.log();
  console.log(
    `  alignment  identical=${al.counts.identical}  changed=${al.counts.changed}  ` +
      `onlyA=${al.counts.onlyA}  onlyB=${al.counts.onlyB}  (fastPath=${al.fastPath})`,
  );
  console.log(`  shape      ${al.rows.map((r) => GLYPH[r.kind]).join('')}`);
  console.log();
  console.log(`  DIVERGENCES (${divs.length}) — what n/p navigate`);
  for (const d of divs) {
    console.log(
      `    ${String(d.index).padStart(2)}. rows ${d.startRow}–${d.endRow}  ` +
        `[${d.kind}]  ${d.summary}`,
    );
  }

  const first = divs[0];
  if (!first) {
    console.log('\n  !! no divergence found — fixture pair is not exercising the diff');
    failures++;
    continue;
  }

  console.log(`\n  FIRST DIVERGENCE — row ${first.startRow}`);
  const row = al.rows[first.startRow];
  const aStep = row.a ? `A:${row.a.step.id} (${row.a.step.type})` : 'A: —';
  const bStep = row.b ? `B:${row.b.step.id} (${row.b.step.type})` : 'B: —';
  console.log(`    ${aStep}   ↔   ${bStep}`);
  if (row.sim !== undefined) console.log(`    pairing similarity ${row.sim.toFixed(3)}`);

  if (row.fields?.length) {
    console.log('\n    FIELD DIFF');
    for (const f of row.fields) {
      if (f.op === 'removed') console.log(`      − ${pad(f.path, 26)} ${fmt(f.before)}`);
      else if (f.op === 'added') console.log(`      + ${pad(f.path, 26)} ${fmt(f.after)}`);
      else console.log(`      ~ ${pad(f.path, 26)} ${fmt(f.before)} → ${fmt(f.after)}`);
    }
  } else {
    console.log('    (structural — no paired step at this row)');
  }
}

console.log(`\n${'═'.repeat(96)}`);
console.log(failures === 0 ? 'All fixture pairs produced a divergence.' : `${failures} pair(s) produced no divergence.`);
process.exit(failures === 0 ? 0 : 1);
