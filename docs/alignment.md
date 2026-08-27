# Alignment specification

Status: **spec, written before implementation** (per V1 build order, step D).

This document defines how two traces are aligned into a single sequence of
comparable rows, and in particular how ambiguous **repeated anchors** are
resolved. It is the normative reference for `src/core/diff/`.

---

## 1. The problem

Alignment is a two-tier operation:

- **anchor** — a coarse key that says *"these are the same kind of step"*.
  Alignment may only pair steps with equal anchors.
- **signature** — a fine key that says *"these are the same step with the
  same content"*. Used only after pairing, to classify a pair as
  `identical` or `changed`.

The product requirement is:

> same semantic step with changed arguments → **CHANGED**,
> not DELETE + INSERT.

Anchoring on tool *name* (not arguments) achieves that for the simple case.
It breaks down when the same anchor repeats.

### 1.1 The repeated-anchor failure

```
A:  search   search   search   read
B:  search   search            read
```

Plain LCS over the anchor strings finds a subsequence of length 3, but the
choice of *which* `search` in A is unpaired is arbitrary — it falls out of the
tie-breaking order of the LCS implementation, not out of the data. If the
implementation drops A₀ when the real extra call was A₁, every downstream row
is misaligned and reports a spurious `changed`, which is exactly the noise the
product exists to eliminate.

LCS cannot fix this, because LCS's objective function (maximize match count)
is indifferent between the candidate alignments. **The objective function is
wrong, not the tie-break.**

---

## 2. Approach: weighted global alignment

Replace binary-match LCS with **Needleman–Wunsch global alignment over a
continuous match score**.

```
score(match i,j) = M_BASE + M_SIM · sim(aᵢ, bⱼ)     if anchor(aᵢ) = anchor(bⱼ)
                 = −∞                                otherwise
score(gap)       = GAP
```

where `sim ∈ [0,1]` is a deterministic **local similarity** between two steps
that already share an anchor. The DP maximizes total score, so when several
alignments have the same match *count*, the one whose pairings are most
locally similar wins. Ambiguity is resolved by evidence rather than by
implementation order.

### 2.1 Constants

| Constant | Value | Rationale |
|---|---|---|
| `M_BASE` | `1.0` | Floor value of any anchor-equal pairing. |
| `M_SIM`  | `1.0` | Similarity contributes at most as much again; match ∈ [1.0, 2.0]. |
| `GAP`    | `−0.6` | A delete+insert pair costs −1.2. |

The gap penalty is chosen so that **`worst match (1.0) > delete + insert
(−1.2)`**. This encodes a deliberate bias:

> Anchor equality is itself strong evidence. Once two steps share an anchor,
> we always prefer to pair them rather than split them. Similarity never
> decides *whether* to pair — only *which occurrence* to pair with.

This is the property that guarantees "changed arguments → CHANGED".

### 2.2 Hard constraints

- A `model` step can never align to a `tool_call` step. Anchor equality is a
  precondition, not a preference. Cross-type alignment is not representable.
- `tool:search` never aligns to `tool:fetch`. Tool identity is structural.
- Alignment is order-preserving. Transpositions are not detected — see §6.

### 2.3 Gap ordering

Within a maximal run of unmatched rows, all A-deletions are emitted before all
B-insertions. Unmatched rows are by definition not aligned to each other, so
their interleaving carries no information — the DP's ordering there is a
traceback artifact. Normalizing to `−` then `+` matches diff convention and
makes the compare view read as *"what A did / what B did instead."* The
reordering is stable and never changes a pairing.

### 2.4 Tie-breaking

Cells are evaluated `DIAG`, then `UP` (consume A → `onlyA`), then `LEFT`
(consume B → `onlyB`), each replacing the incumbent only on a strict
improvement. Diagonal therefore wins exact ties, then delete-from-A. Fully
deterministic for a given input; no dependence on object key order or
iteration order anywhere in the scoring path.

### 2.5 Cost

`O(n·m)` time and memory. At the V1 target of ~1,000 steps per trace this is
10⁶ cells (`Float64Array` + `Uint8Array` traceback ≈ 9 MB, single-digit ms).
A fast path skips the DP entirely when both anchor sequences are identical,
which is the common case for near-identical runs. Banding or a Myers/Hirschberg
rewrite is deferred until a real trace makes it necessary — see the V1 decision
to not architect for hypothetical scale.

---

## 3. Anchors

```
model        →  "model"
tool_call    →  "tool:"   + name
tool_result  →  "result:" + (name ?? name of paired call ?? "*")
state        →  "state:"  + sorted unique root segments of changed paths
error        →  "error:"  + (kind ?? "*")
retry        →  "retry"
stop         →  "stop"
```

`tool_result` resolves its tool name through `callId` during normalization, so
a result that omits `name` still anchors to its tool rather than to a wildcard.

---

## 4. Local similarity `sim(a, b)`

Only ever evaluated on anchor-equal pairs. All features are in `[0,1]`;
weights sum to `1.0`.

### 4.1 Structural features (all step types)

| Feature | Definition |
|---|---|
| `ctx` | Neighbour-anchor agreement. `(prev + next) / 2`, where each term is 1 if the anchors at `i∓1` and `j∓1` are equal, 1 if *both* are out of bounds, else 0. |
| `ord` | Occurrence-index proximity. `1 / (1 + \|ordA − ordB\|)`, where `ord` is how many earlier steps in the same trace share this anchor. |
| `pos` | Normalized position proximity. `1 − \|i/(n−1) − j/(m−1)\|`. |

`ctx` and `pos` together produce the rule that **boundary occurrences pair with
boundaries and interior ones absorb the difference** — see Case 3. `ctx` is also
what lets a retry burst align by its surroundings, and `pos` suppresses
long-range pairings. `ord` is the last resort: it decides the narrow symmetric
case where `ctx` ties, by preferring the nearest occurrence index.

### 4.2 Payload features (per type)

| Type | Payload similarity |
|---|---|
| `model` | `0.7 · jaccard(tokens(output))  +  0.3 · eq(stopReason)` |
| `tool_call` | `0.5 · jaccard(argLeafPaths)  +  0.5 · valueAgreement(shared leaf paths)` |
| `tool_result` | own: `0.4 · eq(ok) + 0.3 · eq(error.kind) + 0.3 · jaccard(resultLeafPaths)`; plus `callSim`, the arg-similarity of the two **paired calls**, as a separate weighted feature |
| `retry` | `0.5 · eq(attempt) + 0.5 · eq(reason)` |
| `error` | `0.5 · eq(kind) + 0.5 · jaccard(tokens(message))` |
| `stop` | `eq(reason)` |
| `state` | `jaccard(changed paths)` |

`callSim` is precomputed statically (calls are paired to results *within* each
trace during normalization), so there is no circular dependency between the
alignment and the similarity function.

`eq(x)` returns 1 when both sides are absent — absence is agreement, not
disagreement, because the schema treats nearly everything as optional.

### 4.3 Weights

```
                     payload   ctx    ord    pos    other
default                0.60   0.20   0.12   0.08     —
tool_call              0.55   0.20   0.12   0.08   0.05  attempt equality
tool_result            0.35   0.20   0.12   0.08   0.25  callSim
```

---

## 5. Classification

For each aligned pair, compare **signatures** (the exclusion list is documented
in `src/core/diff/signature.ts`): equal → `identical`, unequal → `changed` plus
a field-level diff. Unpaired steps are `onlyA` / `onlyB`.

A divergence's `summary` **leads with its first row** when that row is a
`changed` pair, then states the extent — `tool:search_invoices · args.id,
args.limit, args.query → +4 in B, −3 in A, 4 changed`.

That first row **is** the divergence point — where the runs are first observed
to differ. Whether what follows is fallout from it is a judgement the tool does
not make and does not display. It reports the divergence point, then the
extent. Runs that open with an unpaired step keep the structural form.

A **divergence** is a *maximal run of consecutive non-identical rows*, not a
single row. `n` / `p` navigate divergences, so one behavioural event —
"B retried, A didn't" spanning `retry + tool_call + tool_result + error` —
is one stop, not four.

---

## 6. Known limitations (accepted for V1)

1. **Transposition.** `[search(x), fetch(y)]` vs `[fetch(y), search(x)]` is
   reported as unpaired steps, not as a reorder. Global alignment is
   order-preserving by construction. Pinned by test so the behaviour is
   deliberate rather than accidental.
2. **Spurious pairing of unrelated same-tool calls.** Two genuinely unrelated
   `search` calls will pair and report `changed`. This is the intended
   trade-off: the field diff makes it immediately obvious, whereas the
   opposite failure (hiding the real divergence point behind DELETE+INSERT) is silent.
3. **No embedding or model-based similarity.** All features are lexical,
   structural, or exact-match. Deterministic, offline, explainable.

---

## 7. Ambiguous cases that must be tested

These are the acceptance cases for `align.ts`. Each has an unambiguous
correct answer that plain LCS does not reliably produce.

### Case 1 — extra occurrence in the middle of a repeated run

```
A:  search(q="alpha")   search(q="beta")   search(q="gamma")   read(id=7)
B:  search(q="alpha")                      search(q="gamma")   read(id=7)
```

**Required:** A₀↔B₀ `identical`, A₁ `onlyA`, A₂↔B₁ `identical`, A₃↔B₂
`identical`. Exactly one divergence. A position-driven LCS may instead pair
A₁↔B₁ and drop A₂, producing two spurious `changed` rows.

### Case 2 — retry burst, correct call is the *second* one

```
A:  model   search(id="INV-1")   result(ok)     model
B:  model   search(q="INV-1")    result(0 hits) retry   search(id="INV-1")   result(ok)   model
```

**Required:** A's single `search` pairs with B's **second** search (`id="INV-1"`,
argument-identical) rather than with B's first, positionally-adjacent one.
Argument evidence must beat positional adjacency. Likewise A's `result(ok)`
pairs with B's `result(ok)` via `callSim` + `eq(ok)`, not with B's `0 hits`.

### Case 3 — indistinguishable repeats

```
A:  search(q="x")   search(q="x")   search(q="x")   stop
B:  search(q="x")   search(q="x")                   stop
```

**Required:** the **interior** occurrence (A₁) is the one dropped; A₀ pairs with
B₀ and A₂ pairs with B₁. Deterministic and stable across reruns.

Payload similarity is identical for every candidate, so the outcome is decided
by `ctx` and `pos`: the boundary occurrences are anchored by what flanks them —
A₀ and B₀ both open the trace, A₂ and B₁ are both immediately followed by
`stop` — while the interior one is anchored by nothing distinctive. Dropping
the least-anchored occurrence is the right answer and it falls out of the
scoring rather than out of a tie-break rule.

> This corrects an earlier draft of this spec, which predicted "pair the
> earliest, drop the last." That was wrong: it ignored the fact that the
> trailing occurrence is context-anchored to the terminator. The behaviour
> above is what the scoring produces and is the better answer; the rule is
> **boundary occurrences pair with boundaries, interior ones absorb the
> difference.**

### Case 4 — indistinguishable results must follow their calls (`callSim`)

```
A:  search(id="X")   result{status:"ok"}
B:  search(q="X")    result{status:"ok"}   search(id="X")   result{status:"ok"}
```

Both of B's results are **byte-identical**, so nothing in the result payload can
distinguish them, and both `ord` and `pos` favour the *first*. The correct
answer is the second: it is the result of the call that actually matches A's.

**Required:** `A₀↔B₂` and `A₁↔B₃`. Only `callSim` — a result inheriting the
argument similarity of its paired call — can produce this. Isolates the
call/result relationship signal.

> **Note on `ctx`.** In the narrowest symmetric case — two adjacent identical
> repeats against one, with nothing else in the trace — whichever candidate
> gains agreement on its left loses it on its right, so `ctx` scores `0.5` for
> both and cannot break the tie; `ord` decides. As soon as the run has a
> distinguishable boundary (a terminator, a different flanking tool), `ctx`
> dominates and produces the Case 3 result. `ctx` is also unit-tested directly.

### Case 5 — no false pairing across tools

```
A:  search(q="x")
B:  fetch(u="x")
```

**Required:** `onlyA` + `onlyB`. Never a `changed` pair. Guards the hard
anchor constraint.
