# Civil Gold v1

This directory defines the versioned annotation contract. It intentionally contains **no real-jurisprudence labels yet**. Structure precision/recall and citation precision/recall remain `PENDING_HUMAN_GOLD` until external reviewers complete the exhaustive packages.

## Reproduce the review package

From the repository root, run the read-only sampler through the database guard:

```powershell
pnpm --filter back run legal-gold:sample -- --limit 400 --seed galilei-civil-editorial-gold-v1 --output human-review
```

It accepts optional `--year YYYY` and `--sala NAME` filters. It reads only the exact local DEV database `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`, inside a `REPEATABLE READ READ ONLY` transaction that is rolled back. The package is written under `_recovery-work/galilei-editorial-gold-recall-suite4/`; judgment text is not committed.

The sampler selects only public, active judgments with a latest GENERAL extraction and page rows. It uses a fixed seed, proportional largest-remainder allocation across year × Sala × MIME type × extracted-text quality × long-document flag (>30 pages), and a deterministic SHA-256 order within each stratum. The manifest also records detailed short/medium/long length distributions. It includes the population, exact stratum/sample counts, per-document inclusion weights, source checksum hashes, and SHA-256 checksums. The package contains 400 judgments, separate 120-document structure and 150-document citation review assignments drawn only from documents with extracted text, and a public/active metadata-only target catalog. Any sampled document with zero extracted characters is listed in `excluded-from-human-review.jsonl` and cannot count as a negative/no-structure label.

The review templates begin with `PENDING_HUMAN_GOLD`, empty labels, and `exhaustive: false`. Parser candidates are emitted separately by the evaluation command and must never be copied into expected labels. Reviewers should inspect the complete source first; candidate overlays are only a second-pass completeness aid.

## Validate and import human labels

Copy each `*-labels-template.jsonl` to `structure-labels.jsonl` or `citation-labels.jsonl`, have a reviewer complete every assigned source, then run:

```powershell
pnpm --filter back run legal-gold:validate
pnpm --filter back run legal-gold:import
pnpm --filter back run legal-gold:evaluate
```

The validator checks each label against the assignment, document ID, source hash, valid page numbers, allowed enums, and target catalog. Import requires all assigned documents to be exhaustively reviewed and writes only compact annotation records to this fixture directory; it never imports source judgment text. Reviewers use a pseudonymous reviewer ID. Do not put personal data or private/unpublished material in this directory.

The JSON Schemas in `schema/` are the machine-readable contracts. `legal-gold-tools.test.mjs` protects the importer/evaluator behavior with synthetic tool tests; those tests are not legal ground truth.
