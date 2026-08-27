import { validateTrace } from '../schema/validate';
import { nativeAdapter } from './native';
import { claudeCodeAdapter } from './claude-code';
import type { ImportResult, TraceAdapter } from './types';

const adapters: TraceAdapter[] = [nativeAdapter, claudeCodeAdapter];

export function register(adapter: TraceAdapter): void {
  const i = adapters.findIndex((a) => a.id === adapter.id);
  if (i >= 0) adapters[i] = adapter;
  else adapters.push(adapter);
}

export function listAdapters(): readonly TraceAdapter[] {
  return adapters;
}

/** Highest confidence wins; ties break on registration order. */
export function detectAdapter(raw: unknown): { adapter: TraceAdapter; score: number } | undefined {
  let best: { adapter: TraceAdapter; score: number } | undefined;
  for (const adapter of adapters) {
    const score = adapter.detect(raw);
    if (score > 0 && (!best || score > best.score)) best = { adapter, score };
  }
  return best;
}

/**
 * raw JSON → Trace. Never throws: a bad file produces a reportable result, so
 * the import surface can show the user exactly what is wrong with their file.
 */
export function importTrace(raw: unknown): ImportResult {
  const found = detectAdapter(raw);
  if (!found) {
    return {
      ok: false,
      issues: [
        {
          where: '(root)',
          path: '(root)',
          message: `No adapter recognized this file. Expected \`"schema": "agenttrace/v1"\`. Registered: ${adapters
            .map((a) => a.name)
            .join(', ')}.`,
        },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = found.adapter.parse(raw);
  } catch (e) {
    return {
      ok: false,
      adapterId: found.adapter.id,
      issues: [{ where: '(root)', path: '(root)', message: `${found.adapter.name} adapter failed: ${(e as Error).message}` }],
    };
  }

  const validated = validateTrace(parsed);
  if (!validated.ok) return { ok: false, adapterId: found.adapter.id, issues: validated.issues };

  // Schema warnings plus whatever the adapter knows it could not represent.
  const limitations = found.adapter.limitations?.(validated.trace, raw) ?? [];

  return {
    ok: true,
    trace: validated.trace,
    adapterId: found.adapter.id,
    warnings: [...validated.warnings, ...limitations],
  };
}
