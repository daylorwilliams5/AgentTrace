# Real-agent validation

Record of the validation runs that shaped the behavioural signature. Kept so
later changes can be checked against measured behaviour rather than intuition.

All traces were produced by real Claude Code sessions, converted through
`src/core/adapters/claude-code/`, and are committed under `src/fixtures/real/`.

---

## Method

Two sessions per experiment, differing by **one line of `CLAUDE.md`** and
nothing else. Both ran against a frozen copy of this repository whose tree hash
was verified byte-identical before and after each run. Fresh sessions, pinned
session ids, same model, same tool allowlist, byte-identical prompt read from a
file, one prompt per session.

An earlier attempt was discarded: a concurrent Claude Code session modified
three files mid-experiment, breaking the "same tree" control. The frozen-snapshot
protocol was adopted in response.

| pair | task | controlled change |
|---|---|---|
| `instruction-change` | *"which file under `src/core/` has the most lines, and which exports does it declare?"* | A adds *"Before answering a counting question, verify the count using a second, different tool."* |
| `import-report` | *"import dependency report for `src/`… which file is imported by the most other files?"* | A adds *"Use Grep to inspect imports rather than reading entire files."* |

---

## What the long run exposed

`import-report` produced 41 vs 35 steps and 63 aligned rows. Seven rows aligned
as `identical` — and **all seven were model turns with no visible output**.

`agenttrace/v1` stores a model turn separately from the tool calls it produced,
so a turn that emitted only a `tool_use` block leaves an empty husk:
`{output: "", stopReason: "tool_use"}`. Every such husk hashed identically. Two
turns were therefore reported as behaviourally identical when one fired **eight
parallel greps** and the other ran **one shell command**.

Those seven false-identical rows also sat between the difference regions, so
they were splitting one continuous divergence into seven apparent regions.

## The change

A signature may never be built from no evidence. When a model step has no
visible output, its observable evidence is the set of tools it decided to call,
so the ordered anchors of the immediately-following `tool_call` run are folded
into its signature (`SignatureContext` in `core/diff/signature.ts`, computed by
`core/model/normalize.ts`).

Turns with visible output are untouched. Turns that emitted no tools are also
untouched — no context is invented for a producer that recorded none, and two
genuinely contentless turns may still compare equal.

## Measured effect

| | before | after |
|---|---|---|
| aligned rows | 63 | 63 |
| identical rows | 7 | **1** |
| substantive identical rows | 0 | **1** |
| difference regions | 7 | **1** |
| vacuous identities remaining | 7 | **0** |
| first observable difference | `tool:Bash · args.command, args.description` | unchanged |
| repeated-anchor pairings | — | unchanged |
| all four synthetic fixture shapes | — | unchanged |

Every surviving identical row is justified by its emitted tools:

```
row  0  identical   A[Bash]     B[Bash]      ← both runs opened by calling Bash
row  6  changed     A[Grep]     B[Bash]
row 11  changed     A[Grep ×8]  B[Bash]
row 30  changed     A[Grep ×2]  B[Bash]
row 37  changed     A[Read]     B[Bash]
row 46  changed     A[Read]     B[Bash]
row 54  changed     A[Grep]     B[Bash]
```

The 7 → 1 region collapse is **correct, not a regression**. The regions were
separated only by the false-identical rows; the two runs share no tool after
step 3 and never reconverge, so one continuous difference region is the truthful
representation. No artificial segmentation was added to restore the old
navigation granularity.

`instruction-change` was unchanged by the fix: its single empty-output row stays
identical because both runs emitted `Bash`.

At the checkpoint: **153 tests passing; typecheck, lint and build clean.**

---

## Interpretation

> Real-agent validation exposed that contentless model turns could create false
> agreement between otherwise divergent executions. AgentTrace was updated so
> empty-output model turns incorporate the tools they emit into their
> behavioural representation. This eliminated unsupported identical regions
> without changing previously correct alignments or the first observable
> difference.

**AgentTrace surfaces observable behavioural divergence. It does not determine
why the divergence occurred.** Nothing in the trace, the alignment, or the UI
attributes a cause, ranks severity, or claims one run was correct. The rows
above state which tools each run emitted; they do not state why.

---

## Adapter limitations observed on real data

Claude Code transcripts do not record everything `agenttrace/v1` can express.
The adapter reports these on import rather than hiding them:

- **No stopping decision.** `stop_reason` is the per-turn API reason, not a
  run-level outcome. No `stop` step is emitted and `trace.status` is `unknown`,
  so the run-outcome header — the top of the visual hierarchy — reads
  `unknown / unknown` for real Claude Code pairs.
- **No retries, no state changes.** Those step types are absent, not empty.
- **Tool-result status is often unreported.** `is_error` is present on roughly
  half of all results. `instruction-change` measured 25% / 50% unknown per run;
  `import-report` measured 87.5% (A, Grep-heavy) vs 0% (B, Bash-only) — a
  one-line instruction changed how observable the run was. Unknown is carried as
  `status: 'unknown'` and never rendered as a confirmed success.
- **Result content is shown alongside the reported status, never used to
  override it.** A shell command that printed `no matches found` while the
  transcript reported success is displayed as both facts. No content parsing.

## Coverage this validation does not provide

Claude Code emits no retries, no state steps and no stopping decisions, so those
paths remain covered only by the synthetic fixtures. This validation exercises
`model`, `tool_call`, `tool_result` and `error` on real data.
