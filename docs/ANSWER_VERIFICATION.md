# DAWN — Answer Verification (groundedness)

When DAWN answers using your **Local Knowledge**, it now checks its own answer against the sources it
retrieved and shows how well each statement is supported. This is a **local, deterministic** check —
not an external judge and not another LLM — so it is honest about what it can and cannot confirm.

## What it does

After an answer is generated (only when local knowledge was actually retrieved), DAWN:

1. splits the answer into claim sentences,
2. scores each claim by **salient-token overlap** against the retrieved chunks, and
3. labels each claim:
   - **supported** — a retrieved chunk covers most of the claim's key terms,
   - **partially supported** — a chunk covers some,
   - **unsupported** — chunks were retrieved but none supports the claim,
   - **not enough evidence** — nothing relevant was retrieved.

A compact summary appears under the answer (e.g. *"Grounding: 3 supported · 1 unverified (of 4)"*),
expandable to per-claim detail with the supporting source **name** (never its path). If some claims
can't be verified, DAWN says so: *"Some statements could not be verified against your local sources."*

## Why it's conservative (and honest)

- It is **lexical overlap**, not semantic proof — it will not *assert* a claim is true, only that your
  sources do (or don't) appear to support it. It errs toward flagging rather than reassuring.
- It **never fabricates support**: no source, no "supported".
- Retrieved text is treated as **data to compare against** — never executed or obeyed — so
  prompt-injection text inside a source can't do anything here (it's just scored).
- The summary contains **no chunk text, no file path, and no secrets** — only counts, claim text, and
  source names.

## Settings

`answerVerificationEnabled` (default **on**). When off, answers are shown without the grounding summary.

## Honest limits

Overlap-based grounding can mislabel paraphrases (a correct paraphrase with different words may show as
"partial"). It's a **signal**, not a verdict. A future loop can add an optional local-model entailment
check for higher precision. Implementation: pure, tested `answerVerificationCore.ts`
(`tests/retrieval.test.ts`). See also [LOCAL_KNOWLEDGE.md](LOCAL_KNOWLEDGE.md) and [EVALS.md](EVALS.md).
