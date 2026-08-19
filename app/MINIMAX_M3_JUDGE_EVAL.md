# MiniMax M3 judge evaluation

Date: 2026-08-19

## Decision

MiniMax M3 is clearly cheaper than the previously pinned Qwen 3.5 397B endpoint for this
workload. Its exact-tier fidelity is lower than the original quality target, but every holdout
prediction was adjacent and the owner explicitly accepts that drift for this hobby project.
MiniMax M3 became the active judge on 2026-08-19.

The selected MiniMax configuration is:

- model: `minimax/minimax-m3`
- OpenRouter provider: `Together`, fallback disabled
- prompt: `minimax-m3-v3`
- structured JSON Schema: enabled, with required-parameter routing
- reasoning effort: `low`
- temperature: `0`
- production batching: up to 5 posts and a 10,000 estimated-post-token budget

OpenRouter currently lists MiniMax M3 at $0.23/M input and $0.96/M output at its cheapest
endpoint, with image/video input and JSON-schema structured output support:
https://openrouter.ai/minimax/minimax-m3/benchmarks

## Evaluation design

The candidate was evaluated against human rubric judgments, not Qwen outputs and not agreement
with current production results.

- Prompt-development set: 15 active calibration entries, exactly 3 per tier. Each scored entry
  was removed from the calibration examples for its own request (leave-one-out).
- Final holdout: 28 entries, disjoint from calibration. It combines 13 audited historical cases
  with 15 independently selected Jul-Aug 2026 cases whose existing `ai_analysis` rows were not
  consulted.
- Final tier balance after adjudication: 5 gem / 6 banger / 6 solid / 6 mid / 5 pass.
- Inputs matched the judging pipeline: Show HN text, fetched page text, README text, and screenshot
  where present.
- Primary metrics: exact tier, adjacent-tier agreement, schema failures, required editorial-field
  completeness, highlight length, latency, tokens, and provider-billed cost.

The holdout was run once after the prompt was frozen. A second label audit then corrected three
rubric inconsistencies while leaving the predictions unchanged. Both pre-adjudication and final
scores are reported so the correction cannot be mistaken for a new untouched test.

## Label audit

The following material label decisions changed or were excluded:

| Case | Audit decision | Reason |
| --- | --- | --- |
| Open-law MCP servers | gem -> banger | Machine-readable law and legal retrieval already existed; breadth and execution are the differentiators. |
| Smol machines | solid -> banger | The installable microVM implementation and sub-200ms portable workloads clear the banger bar. |
| GPU-building game | banger retained | The first audit demoted it for unfinished later acts, but the production rubric explicitly names a real in-browser GPU builder as a banger archetype. |
| Gemma Gem | banger retained | The production rubric explicitly names local Gemma/WebGPU plus DOM tools as a banger architecture, despite current reliability limits. |
| HDR “superwhite” tool | banger -> solid | A clever, working novelty, but narrow and based on credited prior research rather than a new feasibility boundary. |
| Micro-habit tracker | restored as pass calibrator | A paper grid or spreadsheet reproduces the entire product. Repeated model disagreement is not grounds to discard the label. |
| RTS provenance protocol | excluded | Its live repository gained a runnable Python starter, tests, scripts, and services, invalidating the stored “no implementation” rationale. |
| FreeFlow alternative | excluded | The solid/banger boundary remained too subjective for exact-match ground truth. |

The final holdout still includes inherently subjective adjacent boundaries. Exact match is therefore
reported together with adjacent agreement rather than presented as a complete measure by itself.

## Prompt tuning results

All prompt iterations used only the 15-item calibration set.

| Prompt | Exact | Adjacent | Schema errors | Notes |
| --- | ---: | ---: | ---: | --- |
| Existing production prompt | 60.0% | 93.3% | 0/15 | Reliable only after provider pinning and strict schema. |
| MiniMax v1 | 66.7% | 100% | 0/15 | Boundary overrides helped but hurt highlight compliance. |
| MiniMax v2, two deterministic repeats | 73.3% | 100% | 0/30 | Both temperature-0 repeats produced the same labels. |
| MiniMax v3, selected | 80.0% | 100% | 0/15 | Best tier balance and 93.3% highlight compliance. |

Automatic provider routing with ordinary JSON mode was unreliable: 4 of 15 calibration requests
were empty or truncated. Pinning Together and requiring JSON-schema support eliminated output
failures in the subsequent observed runs (127 API calls, including batch calls).

## Holdout results

### One post per request

| Metric | Result |
| --- | ---: |
| Exact tier, labels as frozen before the run | 57.1% (16/28) |
| Exact tier, final human-adjudicated labels | 67.9% (19/28) |
| Within one adjacent tier | 100% (28/28) |
| Schema/output failures | 0 |
| Complete editorial fields | 100% |
| Highlight at most 15 words | 89.3% |
| Average request latency | 3.24 s |

The final-adjudicated per-tier exact counts were 2/5 gem, 5/6 banger, 6/6 solid, 4/6 mid,
and 2/5 pass.

### Production-style batches

Seven calls processed the 28 posts using the app's normal up-to-five-post, 10k-token batching.

| Metric | Result |
| --- | ---: |
| Exact tier, labels as frozen before the run | 50.0% (14/28) |
| Exact tier, final human-adjudicated labels | 53.6% (15/28) |
| Within one adjacent tier | 100% (28/28) |
| Schema/output failures | 0 |
| Complete editorial fields | 100% |
| Highlight at most 15 words | 96.4% |
| Average API-call latency | 10.23 s |

Batching materially reduces cost, but it also lowers exact-tier fidelity. M3 still recognizes much
of the evidence: several clear errors contain the correct critique (for example, “just a markdown
prompt” or “already served by CyberChef”) and then emit `mid` instead of the rubric-mandated
`pass`. It also compresses several shareable gems into bangers.

## Cost benchmark

The recent 100-call production sample contained 252 judged posts and averaged 3,053.5 input plus
1,023.2 output tokens per post. The current Qwen route is pinned to Alibaba, which OpenRouter lists
at $0.39/M input and $2.34/M output:
https://openrouter.ai/qwen/qwen3.5-397b-a17b

That mix costs approximately **$3.585 per 1,000 posts** before any unrelated infrastructure costs.

| MiniMax mode | Input / output | Billed total | Billed / 1k posts | Cold Together / 1k posts |
| --- | ---: | ---: | ---: | ---: |
| One post per request (28 posts) | 175,414 / 5,761 | $0.02636 | $0.941 | $2.126 |
| Production batches (28 posts) | 68,837 / 5,750 | $0.01907 | $0.681 | $0.984 |

“Cold Together” removes the observed prompt-cache discount and uses Together's current
$0.30/M input and $1.20/M output rates. Against the current Qwen/Alibaba production estimate,
production-batched MiniMax was about **81% cheaper as billed** and remains about **72.6% cheaper
without cache reads**. Even the more expensive one-post cold run was about 40.7% cheaper.

These are workload measurements, not a claim that token counts will remain identical as traffic
changes. The larger savings come from both lower prices and M3's much shorter judged outputs.

## Recommendation

The project owner chose the cost-first tradeoff and switched the default judge to MiniMax M3 after
reviewing these results. Monitor provider errors, cache-read tokens, tier distribution, and a small
sample of `gem` and `pass` decisions; those are the two boundaries most likely to drift.

The most promising quality improvement is not a longer prompt. It is a deterministic
post-check or small second-stage classifier for terminal rubric failures (`pass`) and gem
compression, followed by a new untouched balanced holdout.
