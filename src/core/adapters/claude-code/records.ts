/**
 * Claude Code transcript record shapes.
 *
 * Derived by profiling 3,948 records across 9 sessions written by Claude Code
 * 2.1.219–2.1.229. The format is undocumented and unversioned, so everything
 * here is optional and every consumer must degrade rather than throw.
 *
 * Ten of the thirteen observed record types (`attachment`, `ai-title`,
 * `last-prompt`, `queue-operation`, `file-history-*`, `custom-title`,
 * `atis-latch`, `mode`, `permission-mode`) carry UI state and file backups,
 * not agent behaviour. They are dropped.
 */

export interface CCUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface CCTextBlock {
  type: 'text';
  text: string;
}
export interface CCThinkingBlock {
  type: 'thinking';
  thinking?: string;
}
export interface CCToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input?: unknown;
}
export interface CCToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: unknown;
  /** Present on only ~51% of results. Absence is NOT success. */
  is_error?: boolean;
}
export type CCBlock =
  | CCTextBlock
  | CCThinkingBlock
  | CCToolUseBlock
  | CCToolResultBlock
  | { type: string; [k: string]: unknown };

export interface CCMessage {
  id?: string;
  role?: 'assistant' | 'user';
  model?: string;
  /** A user prompt may be a bare string; assistant content is always a list. */
  content?: string | CCBlock[];
  stop_reason?: string | null;
  usage?: CCUsage;
}

export interface CCRecord {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isApiErrorMessage?: boolean;
  message?: CCMessage;
  /** Structured tool output. Presence marks a `user` record as a tool result. */
  toolUseResult?: unknown;
  [k: string]: unknown;
}

export function isAssistant(r: CCRecord): boolean {
  return r.type === 'assistant';
}

/** A human turn: a `user` record that is not a tool result and not injected context. */
export function isHumanPrompt(r: CCRecord): boolean {
  return r.type === 'user' && r.toolUseResult === undefined && !r.isMeta;
}

export function isToolResultRecord(r: CCRecord): boolean {
  return r.type === 'user' && blocksOf(r).some((b) => b.type === 'tool_result');
}

export function blocksOf(r: CCRecord): CCBlock[] {
  const c = r.message?.content;
  return Array.isArray(c) ? c : [];
}

export function textOf(r: CCRecord): string {
  const c = r.message?.content;
  if (typeof c === 'string') return c;
  return blocksOf(c ? r : r)
    .filter((b): b is CCTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** Parse a .jsonl body. Unparseable lines are skipped, never fatal. */
export function parseJsonl(text: string): CCRecord[] {
  const out: CCRecord[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t) as CCRecord;
      if (r && typeof r === 'object') out.push(r);
    } catch {
      /* a truncated final line is normal while a session is live */
    }
  }
  return out;
}
