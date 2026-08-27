import type { Trace } from '../schema/types';
import type { ValidationIssue } from '../schema/validate';

/**
 * The extension seam. V1 ships exactly one adapter (`native`). Adding support
 * for another producer later is one file here plus one `register()` call, with
 * zero changes to the diff or the UI — that is the entire point of keeping
 * core/ free of React.
 */
export interface TraceAdapter {
  id: string;
  name: string;
  /**
   * Confidence that this adapter owns the payload. 0 = not mine, 1 = certain.
   * The registry picks the highest scorer; ties break on registration order.
   */
  detect(raw: unknown): number;
  /** Convert to agenttrace/v1. May throw; the registry reports the failure. */
  parse(raw: unknown): Trace;
}

export type ImportResult =
  | { ok: true; trace: Trace; adapterId: string; warnings: ValidationIssue[] }
  | { ok: false; adapterId?: string; issues: ValidationIssue[] };
