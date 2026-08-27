/**
 * core/ — pure TypeScript. Zero React, zero DOM.
 *
 * This boundary is load-bearing: it is what makes the adapter story real
 * rather than aspirational, and it is what lets the alignment be tested
 * against plain fixtures.
 */

export * from './schema/types';
export { validateTrace, traceSchema, stepSchema } from './schema/validate';
export type { ValidationIssue, ValidateResult } from './schema/validate';

export type { TraceAdapter, ImportResult } from './adapters/types';
export { register, listAdapters, detectAdapter, importTrace } from './adapters/registry';
export { nativeAdapter } from './adapters/native';

export { normalize, toMs } from './model/normalize';

export { anchorOf, rootOf } from './diff/anchor';
export { signatureOf, semanticFieldsOf } from './diff/signature';
export { similarity, argSimilarity } from './diff/similarity';
export {
  align,
  GAP,
  M_BASE,
  M_SIM,
  MAX_CELLS,
  PREFERS_PAIRING,
  AlignmentTooLargeError,
} from './diff/align';
export type { Alignment, AlignedRow, RowKind } from './diff/align';
export { fieldDiff, auxiliaryDiff, summarizeFields } from './diff/fields';
export type { FieldDiff, FieldOp } from './diff/fields';
export { divergences } from './diff/divergence';
export type { Divergence, DivergenceKind } from './diff/divergence';
export { wordDiff, tokenizeWords } from './diff/words';
export type { WordSpan, WordOp } from './diff/words';
