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

  /**
   * Limitations of THIS conversion, surfaced to the user next to the trace.
   *
   * Adapters lose information — a source that records no stopping decision, or
   * no tool-result status, produces an honest but partial trace. Rather than
   * hide that, an adapter states it here and the import surface shows it. These
   * never block an import.
   */
  limitations?(trace: Trace, raw: unknown): ValidationIssue[];
}

export type ImportResult =
  | { ok: true; trace: Trace; adapterId: string; warnings: ValidationIssue[] }
  | { ok: false; adapterId?: string; issues: ValidationIssue[] };
