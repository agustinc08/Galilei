# Page-aware OCR research — architecture assessment

Date: 2026-10-27  
Base: `48736d1f82152d2e021b0fb9a660e3648a13b3ed`  
Scope: Sprint 9 feature worktree only. No principal database, Corpus storage, or OpenSearch writes.

## Existing authoritative records

- `CorpusDocument.latestExtractionId` is the explicit active extraction pointer. Search joins this pointer; extraction timestamps are not used to guess which version is active.
- `CorpusExtraction` stores the active extraction text, status, extractor/version, and JSON provenance.
- `CorpusDocumentPage` stores 1-based physical PDF page number, text, `textKind`, OCR processing status, and optional confidence. The unique key is extraction + page.
- Suite 8 approval creates a new `OCR_HUMAN_APPROVED` extraction and page rows with `textKind=OCR`, `processingStatus=OCR_HUMAN_APPROVED` (or `NO_TEXT_CONFIRMED`), source-file SHA, document checksum, reviewer and time; it changes `latestExtractionId` transactionally and appends an approval record. Draft/reopened review state is separate, so the old approved extraction remains active until reapproval.
- Search outbox triggers on Corpus changes and keeps PostgreSQL authoritative when OpenSearch is unavailable.

## Search and page mapping

Search is federated. OpenSearch V4 produces the ordered Corpus candidate IDs; the PostgreSQL Corpus hydrator attaches current document metadata and page-level provenance without changing candidate order or Search ranking. Its strict V4 mapping is already deployed and must not be altered for this feature.

The hydrator is constrained to the document's active `latestExtractionId`. It selects a matching row from `CorpusDocumentPage` in the same bounded SQL hydration used for the result page, rather than fetching a page per result or deriving page numbers from flattened offsets. Page snippets and source labels must come only from that selected active page. For approved OCR, the invariant is both extraction status `OCR_HUMAN_APPROVED` and the page's OCR-approved processing status. Native page rows are labeled `PDF_TEXT`. If page-level text is unavailable, retain the normal result while omitting page provenance; never infer a page.

Search still obeys the existing Copernic lexical contract: case-insensitive, accent-tolerant with ñ distinct; prefix for plain terms, exact quoted word and exact quoted lexical phrase; no stemming, synonyms, or semantic fallback. Page enrichment is metadata only and cannot reorder candidates or make a draft page searchable.

## Match spans, snippet, and XSS

The existing Corpus match utility keeps UTF-16 offsets and page-local spans while normalizing accents. Reuse it for deterministic page-match selection and span calculation. The snippet is a bounded excerpt from that exact active page (target 250–500 visible characters; no more than the existing copy-fragment cap). The UI renders text nodes and never injects OCR/native text as HTML. No raw internal extraction IDs, storage paths, local usernames, OCR temp paths, or secrets go to the public DTO.

## Viewer and research provenance

The existing Corpus PDF route accepts a 1-based `page` query parameter and clamps invalid pages; result actions reuse this route and preserve the current Search URL/query context. The PDF remains the visual authority. OCR-derived text is labeled “OCR revisado” and must be associated with a physical PDF page, not an “OCR page”.

The already-present `SentenciaRelationshipCandidate` fields represent parser source extraction, source checksum, page, UTF-16 offsets, text kind, context, parser version, and explicit `DETECTED_CANDIDATE` status. Suite 9 should route approved Corpus OCR through the existing citation parser / human-review state machine only where a canonical Jurisprudencia identity link exists. It must not guess identity, self-citations, ambiguity, or verified state. Human confirmation remains the only path to a verified relationship.

The research bundle currently uses `galilei-research-bundle/1`; page/source/checksum are optional, backward-compatible manifest fields. Comparison keeps its existing legal metadata matrix; Evolution continues to order by decision date and treats verified citations through its normal workflow. Search snippets are not copied into collections or notes automatically.

## ACL, publication, and privacy

Search candidate selection and PostgreSQL hydration preserve the existing visibility/scope filters and private-workspace membership ACL. Page text is returned only for a result the existing Search ACL already permits. Public Search must not return unpublished/private OCR. Direct page metadata and PDF endpoints must continue applying document/workspace ACL. OCR approval is not publication and does not mutate publication fields.

## Schema decision

**MIGRATION_40_REQUIRED: NO.** The required active source, physical page, native/OCR text kind, approval state, extraction/version, and approval checksum/provenance are representable from schema 39. Page checksums and safe page-match metadata are derived from the active page at read time; no additional durable invariant is needed. This keeps future office replay at 37 → 39 with no extra migration.

## Index decision

**No mapping change and no full Search rebuild.** Search V4 remains the candidate/ranking projection; PostgreSQL is already the source for current Corpus hydration and active page rows. Page metadata is attached after candidate selection in one bounded hydration query, preserving Search semantics, ordering, and the strict V4 mapping.

## Certification status — 2026-10-27

The isolated PostgreSQL 16.15 + OpenSearch 2.19.6 integration was exercised with synthetic Corpus/PDF data. Four real-service tests passed, including active 50-page mixed-source hydration, rejection of unapproved draft OCR from Search, preservation of the original PDF checksum, and outbox recovery after an isolated Search outage. The PostgreSQL migration matrix passed 0→39, 37→39, 38→39, and 39→39. Local client/server typecheck, lint, tests, and builds passed; see the external Sprint 9 evidence directory for command logs and structured reports.

These results do not certify an exact remote GitHub Actions run, institutional human UAT, parser gold labels, a production-corpus Search latency distribution, or every listed security/browser scenario. Those remain explicitly pending until their evidence is recorded. The feature does not perform a principal Search rebuild or write to principal PostgreSQL, Corpus, Search, DEV, main, or Sytec10.
