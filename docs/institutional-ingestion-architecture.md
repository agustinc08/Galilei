# Institutional jurisprudence intake architecture

## Purpose and boundaries

This document records the existing persistence and access model before the Sprint 7 implementation. Institutional intake is an orchestration workflow over the canonical Corpus and Sentencia domains. It does not create a second PDF store, a second extraction pipeline, or a publication path.

All intake-created Corpus documents start `INTERNAL`, `GENERAL`, and unreviewed. Uploading a PDF, confirming metadata, linking a Sentencia, and publishing a Sentencia remain separate actions. Search indexes are projections and never become the source of truth. This work must not connect to principal or office services, modify principal data, or perform historical document acquisition.

## Existing canonical records

| Concern | Existing owner | Sprint 7 use |
| --- | --- | --- |
| Legal judgment | `Sentencia` | Existing record selected only after an authorized user confirms an unambiguous candidate; new records are explicit unpublished drafts. |
| Canonical document | `CorpusDocument` | One internal general-scope record per new institutional file identity; retain current ACL and curation behavior. |
| Physical PDF identity | `CorpusDocumentFile` | SHA-256, byte count, MIME, page count, version, and content-addressed storage key. Exact bytes are deduplicated by hash. |
| Physical bytes | `LocalDocumentStorageAdapter` / configured Corpus storage root | Reuse the hash-addressed key scheme. Never derive a canonical path from a submitted filename. |
| Intake provenance | `CorpusIngestionRecord` + `CorpusSourceSystem` | Record source `INSTITUTIONAL_UPLOAD`, checksum, source metadata, and idempotency. Do not use external IDs that can update an existing Corpus document. |
| Extracted text/pages | `CorpusExtraction` + `CorpusDocumentPage` | Reuse `BasicDocumentTextExtractor`; retain native text and `OCR_REQUIRED` status without inventing OCR output. |
| Domain relationship | `CorpusDocumentLink` and `ArchivoPdf` | Link Corpus to a confirmed Sentencia and preserve the existing PDF viewer contract. Do not replace an existing different PDF. |
| Publication | `Sentencia.publicado`, `publishedAt`, and `estadoCarga` | Draft creation is explicitly unpublished (`BORRADOR`, `publishedAt = null`). Existing publication authority and workflow remain unchanged. |
| Audit | `LogsService.registrarAccion` / `AccionLog` | Record actor, action, safe object IDs, and outcome. Never log PDF bytes or extracted full text. |
| Search | Existing PostgreSQL/OpenSearch projections and their existing outbox/reconciliation paths | Do not write directly to OpenSearch. Preserve current public filters and test internal/public visibility separately. |

## Existing behavior and constraints

- `ArchivosService.uploadSentenciaPdf` already validates a `.pdf` upload, checks its `%PDF-` prefix, computes SHA-256, calls the Corpus pipeline, creates `ArchivoPdf`, marks `Sentencia.tienePdf`, creates a Corpus relationship, and records an audit action. It has a 100 MiB limit.
- `ArchivosService.uploadJurisprudenciaDraft` is a legacy/manual shortcut that creates a minimally populated draft as part of upload. Institutional intake must not use that shortcut because it would collapse upload, metadata confirmation, and explicit draft creation into one step.
- `CorpusIngestionService.ingestOne` owns the current content-addressed Corpus ingestion and extraction flow. It persists Corpus records before extraction completes, then records `INDEXED`, `OCR_REQUIRED`, or failure. The file-system write cannot be transactionally atomic with PostgreSQL; callers need a recoverable workflow state and cleanup for unreferenced temporary/canonical bytes.
- `CorpusDocumentFile` has a unique `(documentId, sha256)` constraint; the SHA index is not globally unique. A safe global duplicate check must therefore resolve all matching file rows and must not assume that one hash already maps to one Corpus document.
- `CorpusDocumentLink` supports a typed cross-domain relationship. `ArchivoPdf` remains necessary for existing Sentencia PDF/viewer behavior. Both records must be created consistently; a different PDF already linked to a Sentencia is a conflict, never a silent replacement.
- The Corpus extractor uses `pdf-parse`, validates PDF structure through the existing detector/extractor path, and reports pages without usable native text as `OCR_REQUIRED`. It does not perform OCR.
- The public jurisprudence search and PDF routes filter for published, active Sentencias. Intake must leave these flags unchanged for existing judgments and create unpublished drafts only through an explicit confirmation.
- Roles available in the application include `ADMIN`, `OPERADOR`, `LECTOR`, `REVISOR`, and `JURISPRUDENCIA`. New upload and workflow mutations must have server-side role checks; `LECTOR` must not upload or access unapproved ingestion detail.

## Sprint 7 implementation

`InstitutionalIngestion` coordinates the intake attempt and references the canonical Corpus document/file, optional source ingestion, and optional linked Sentencia. `InstitutionalIngestionEvent` records workflow transitions with actor and safe outcome. Both models are additive; no PDF bytes or extracted text are duplicated. IDs are opaque, reads require an allowed institutional role, and mutations require `ADMIN`, `OPERADOR`, or `JURISPRUDENCIA`.

Implemented workflow states are:

`VALIDATING` → `METADATA_PENDING` / `DUPLICATE_EXACT` / `OCR_REQUIRED` / `REVIEW_REQUIRED` / `FAILED` → `MATCH_CANDIDATE` / `READY_TO_CREATE_DRAFT` / `REVIEW_REQUIRED` → `LINKED` / `DRAFT_CREATED` / `CANCELLED`.

Persist only validated state transitions. A duplicate response references the existing canonical document/file without creating a second physical blob or file identity. Candidate matching is deterministic and explainable; only exact, unique legal identity is eligible for a suggested unique match. Partial, conflicting, or multiple candidates require a human decision. No fuzzy auto-linking or LLM metadata inference is allowed.

1. The Nest multipart interceptor accepts one file and applies a 100 MiB size limit. The service validates the submitted PDF name/MIME/signature and uses the existing extractor to require a parseable document with at least one page. Malformed inputs fail without creating a usable Corpus file; encrypted inputs are retained as review metadata with a safe error. The current path uses a bounded in-memory multipart buffer, not streaming.
2. Compute SHA-256 before storage. Detect the same hash globally, independent of filename, before creating another `CorpusDocumentFile`. A reused filename with different hash is an informational conflict only; never overwrite.
3. Persist an intake record/event, then call the existing Corpus ingestion/extraction path with `INSTITUTIONAL_UPLOAD`, internal visibility, and no external ID. Metadata is stored only after user confirmation; this flow does not infer legal metadata with AI.
4. Present unique exact Sentencia candidates, possible duplicates, and no-match state without exposing records outside the caller's authorized domain. A user explicitly confirms either a selected existing Sentencia or “Crear sentencia en borrador”.
5. For an existing Sentencia, preserve all legal metadata and publication state. If the same bytes are already linked, return an idempotent no-op. If a different PDF is linked and the current model/viewer policy does not support an additional file, stop in conflict for manual resolution.
6. For a new Sentencia draft, require the legal fields the existing model can validate, leave optional values null, set `publicado=false`, `publishedAt=null`, and `estadoCarga=BORRADOR`, then create the Corpus link and `ArchivoPdf` under one database transaction. Compensate the external storage write if the database operation fails and no canonical reference remains.
7. Audit each action with actor, workflow/document/file/Sentencia IDs, timestamp, and a safe result. Retain state history for queue detail and review.
8. Continue using the current Corpus viewer, file access service, curation/review rules, and existing search projections. The intake feature never grants broader ACL or changes publication state. Public metadata and file routes return not found for the unpublished draft in the real-service smoke.

The implemented UI is `/jurisprudencia/ingreso`; API endpoints are under `/api/corpus/institutional-ingestions`. `ADMIN`, `OPERADOR`, and `JURISPRUDENCIA` may write; `REVISOR` may read but not mutate; `LECTOR` is denied. Queue and detail visibility are institution-wide for read roles, with per-request role checks.

Fresh migration validation reached 38 migrations from zero; incremental validation applied only `20261026160000_institutional_ingestion_workflow` from the 37-migration baseline. Real isolated QA uses PostgreSQL 16 at `127.0.0.1:55434`, OpenSearch 2.19.6 at `127.0.0.1:19200`, Nest, Vite, Edge and a temporary Corpus root. Principal services and Sytec10 are outside the QA configuration and were not written.

## Transaction, retry, and cancellation policy

The filesystem and PostgreSQL do not share a transaction. The intake workflow is the recovery ledger: a retry is idempotent by request key and file SHA, and reports the current durable phase rather than creating a second legal record. A failed database link transaction leaves no `ArchivoPdf` or `CorpusDocumentLink`; any newly written bytes are removed only when there are no Corpus file references, and otherwise are retained as canonical shared content. Cancellation is permitted only before linking or draft creation; cancellation after a committed legal relationship is rejected and must use existing administrative processes.

Concurrent identical uploads converge through database uniqueness plus a transaction/locking strategy around the global hash identity. Candidate resolution and final link/draft creation re-read current records inside the transaction to prevent stale UI decisions from bypassing conflicts. Date-only legal metadata is persisted in a way that round-trips the submitted calendar date without timezone shifts.

## Verification plan

Use synthetic PDFs and isolated PostgreSQL/OpenSearch/Corpus paths only. Verify fresh and incremental migrations, duplicate/race behavior, extractor outcomes, metadata/date round trips, role/IDOR behavior, public non-disclosure, draft publication flags, link/viewer compatibility, Search/outbox behavior, outage recovery, and existing Suite 5/6 regression. Keep principal PostgreSQL, Corpus storage, and Search read-only; do not alter office or production environments.

