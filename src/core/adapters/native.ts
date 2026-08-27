import { SCHEMA_ID, type Trace } from '../schema/types';
import type { TraceAdapter } from './types';

/** agenttrace/v1 — the only adapter in V1. Pass-through; validation happens in the registry. */
export const nativeAdapter: TraceAdapter = {
  id: 'native',
  name: 'agenttrace/v1',

  detect(raw: unknown): number {
    if (!raw || typeof raw !== 'object') return 0;
    const o = raw as Record<string, unknown>;
    if (o.schema === SCHEMA_ID) return 1;
    // Unversioned but structurally native — accept with lower confidence so a
    // hand-written file missing the discriminator still imports.
    if (Array.isArray(o.steps) && typeof o.id === 'string') return 0.4;
    return 0;
  },

  parse(raw: unknown): Trace {
    const o = raw as Record<string, unknown>;
    return { ...(o as unknown as Trace), schema: SCHEMA_ID };
  },
};
