# Structure parser recall analysis — Civil Gold v1

## Current status

**Precision, recall, F1, and judgment-level quality: `PENDING_HUMAN_GOLD`.** The external review package assigns 120 published judgments for exhaustive structure annotation. No ground truth was synthesized from parser output or a language model.

## Preserved Sprint 3 observation

The earlier 200-document sample yielded 78 emitted sections in 35 judgments and 165 judgments without an emitted outline. Sprint 3 reported that the 78 detections were manually checked, but that result is retained as a historical observation only; it does not establish recall, does not label the zero-output judgments, and is not substituted for the new independent exhaustive annotation.

## Measurements after human import

The evaluator will report exact true positives, false positives, false negatives, precision, recall, F1, prevalence-weighted metrics, and judgment-level counts: correctly useful outline, partial outline, no outline despite expected structure, and wrong outline. It will preserve zero-detection judgments in the denominator.

Misses will be grouped by reviewer-coded cause, including OCR punctuation, line breaks, casing, Roman/word ordinals, resolutive wording, page splits, text fragmentation, and historical typography. No parser rule is changed until repeated human-confirmed misses support a conservative rule with positive and negative tests.

## Current parser and performance

Parser version: `argentine-civil-structure-v1`. On the reproducible 400-document sample it emitted an outline for 59 judgments and 170 sections. Runtime was p50 3.147 ms, p95 8.707 ms, max 25.886 ms per document. These are machine observations, not quality metrics. The 120 assigned exhaustive labels are still empty; recall, precision, F1, weighted estimates and the parser-change gate remain `PENDING_HUMAN_GOLD`.

Run `pnpm --filter back run legal-gold:evaluate` to regenerate the separated machine report under `_recovery-work/galilei-editorial-gold-recall-suite4/machine-evaluation/`. The blind review ZIP under the same recovery root includes the structure assignment but no parser candidates. Do not expose machine candidates to reviewers before their independent first pass.
