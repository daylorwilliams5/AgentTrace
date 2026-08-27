/**
 * Export a Claude Code session to agenttrace/v1.
 *
 *   npx vite-node tools/cc-export.ts -- <sessionId|path.jsonl> --out t.json [--redact paths] [--run last|all|N]
 *
 * Fails closed: if the secret sweep finds a likely credential anywhere in the
 * produced trace, nothing is written and the offending locations are reported
 * by path, never by value.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { convertTranscript, scanSecrets, type RedactLevel } from '../src/core/adapters/claude-code';

const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const target = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true);

const out = flag('out');
const level = (flag('redact', 'paths') as RedactLevel) ?? 'paths';
const runFlag = flag('run', 'last')!;
const run = runFlag === 'all' || runFlag === 'last' ? runFlag : Number(runFlag);

if (!target || !out) {
  console.error('usage: cc-export <sessionId|path.jsonl> --out <file> [--redact none|paths|strict] [--run last|all|N]');
  process.exit(2);
}

function findTranscript(idOrPath: string): string {
  if (idOrPath.endsWith('.jsonl')) return idOrPath;
  const root = join(homedir(), '.claude', 'projects');
  for (const dir of readdirSync(root)) {
    const p = join(root, dir, `${idOrPath}.jsonl`);
    try {
      if (statSync(p).isFile()) return p;
    } catch { /* not in this project dir */ }
  }
  throw new Error(`no transcript found for session ${idOrPath}`);
}

const path = findTranscript(target);
const results = convertTranscript(readFileSync(path, 'utf8'), {
  id: target.replace(/\.jsonl$/, ''),
  level,
  home: homedir(),
  run,
});

if (results.length === 0) {
  console.error('no runs found in transcript');
  process.exit(1);
}

for (const [i, r] of results.entries()) {
  const hits = scanSecrets(r.trace);
  if (hits.length > 0) {
    console.error(`REFUSING TO WRITE — ${hits.length} likely secret(s) found:`);
    for (const h of hits.slice(0, 20)) console.error(`  ${h.kind} at ${h.where}`);
    process.exit(3);
  }
  const file = results.length > 1 ? out.replace(/\.json$/, `.${i}.json`) : out;
  writeFileSync(file, JSON.stringify(r.trace, null, 2));

  const s = r.stats;
  const total = s.okTrue + s.okFalse + s.okUnknown;
  const pct = total ? ((s.okUnknown / total) * 100).toFixed(1) : '0.0';
  console.log(`wrote ${file}`);
  console.log(`  source          ${path.replace(homedir(), '~')}`);
  console.log(`  task            ${(r.trace.task ?? '—').slice(0, 72).replace(/\n/g, ' ')}`);
  console.log(`  assistant recs  ${s.assistantRecords} → ${s.turns} turns (grouped by message.id)`);
  console.log(`  steps           ${r.trace.steps.length}`);
  console.log(`  tool calls      ${s.toolCalls}  results ${s.toolResults}  unanswered ${s.unansweredCalls}`);
  console.log(`  ok confirmed    true=${s.okTrue}  false=${s.okFalse}`);
  console.log(`  ok UNKNOWN      ${s.okUnknown}/${total}  (${pct}% of tool results)`);
  console.log(`  redaction       ${level}   secrets found: 0`);
}
