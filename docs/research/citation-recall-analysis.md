# Citation parser recall analysis — Civil Gold v1

## Current status

**Candidate precision, recall, F1, family metrics, resolution accuracy and prevalence-weighted metrics: `PENDING_HUMAN_GOLD`.** The package assigns 150 published judgments for exhaustive citation annotation. Parser output and expected labels are separate artifacts. No model or parser output is used to create ground truth.

## Preserved Sprint 3 observation

The previous 200-document sample reported 6,074 candidates, including 154 self references, 68 exact unique resolutions and 5,852 unresolved candidates. A family-stratified inspection of 50 candidates found 50 valid references. That small inspection does not measure recall, is not prevalence weighted, and is not substituted for the new exhaustive labels.

## Measurements after human import

The evaluator will calculate candidate precision/recall/F1 and per-family support, precision, recall, unique, ambiguous and unresolved outcomes using the recorded inclusion weights. It will separately count wrong unique resolutions; the required target is zero. Resolution causes will use reviewer labels: no corpus target, insufficient target metadata, insufficient parser fields, normalization mismatch, multiple targets, unpublished/inactive target, unsupported external court, self-reference, statute-only, or other.

Statute references remain separate from judgment relationships. Unsupported reference classes must be declared before examining final recall results; they cannot be silently removed from scope.

## Current parser and changes

Parser version: `argentine-citation-parser-v2`. On the 400-document sample it emitted 16,178 references: CIVIL_EXPEDIENTE 64, CNCIV_ROLLO 56, CNCIV_SALA_DATE 323, CSJN_CASE 2, CSJN_DECISION_DATE 112, CSJN_FALLOS 992, EXPEDIENTE_IDENTIFIER 2,032, OTHER_COURT 334, and STATUTE_REFERENCE 12,263. Runtime was p50 0.913 ms, p95 2.411 ms, max 8.695 ms per document; a bounded 2.7 MB adversarial input completed in 4,067 ms (PASS).

The read-only exact-catalog projection found 1,690 case-relationship candidate rows in the sample and projects 25,409 over 6,014 public/active judgments. Total emitted citations, including statute references, project to 243,236. Projected machine outcomes for relationship candidates are 2,451 unique, 22,958 unresolved, 0 ambiguous and 5,984 self references; these are not human-validated resolutions or quality estimates. Projected parser CPU is 29.497 seconds over the population. Hypothetical triage of all emitted citations is 675.7/2,027/4,053.9 hours at 10/30/60 seconds per item; relationship candidates only are 70.6/211.7/423.5 hours. These assume every emitted item is reviewed, are not observed speeds, and omit exhaustive source reading needed to discover misses. Storage impact was not measured. No detector, resolver or backfill change is justified before exhaustive human labels exist. Synthetic regression tests remain tool tests, not corpus gold. The reproducible evaluator writes machine candidates separately from the blind reviewer package.
