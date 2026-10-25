# Research continuity — GALILEI-RESEARCH-CONTINUITY-SPRINT-1

## Purpose and scope

This feature reduces interruptions while researching public civil jurisprudence. It implements the independently designed benchmark concepts Q01–Q06 (saved query, citation copy, result-card favorite, accurate search help, copy current URL, and query explanation) from `docs/research/benchmark-github-2026/quick-wins.md` and `ux-ideas.md`. No external repository code was copied.

The search contract, result ordering, counts, ranking, OpenSearch mapping/index, and PostgreSQL schema are unchanged. No semantic search, AI/RAG, embeddings, automatic validity inference, synonyms, fuzzy search, stemming, migration, reindex, or principal-service writes were introduced.

## Search state and navigation

Public search already represented query, filters, sort, page, and page size in `/consulta` URL parameters. Result detail links preserve the complete query string in `returnTo`, and browser history restores the same route. Sprint 1 keeps that behavior and adds focused coverage for direct deep links and return navigation.

“Copiar enlace de búsqueda” copies an absolute link to the canonical `/consulta` path. It keeps recognized public search parameters, drops unrelated parameters and fragments, and omits default operator/page/page-size values. Clipboard permission failures fall back to the legacy browser copy command; the UI reports success or failure without an alert.

## Favorites

The result card reuses the existing `Favorito` API and `FavoriteButton`. Controls appear only for `ADMIN` and `OPERADOR`, matching the existing server role policy. The state updates immediately and rolls back with a visible message if the request fails. The unique `(usuarioId, sentenciaId)` constraint remains the duplicate guard. A favorite is only a reference and does not grant document access.

Favorite operations do not attach the query text to their existing event records.

## Citation copy

“Copiar cita” fetches the public judgment by its public slug and uses the server-provided `cita.citaCopiable`; the client does not reconstruct or infer legal citation fields. The copy includes a separate stable Galilei source link without the transient search-return query.

The existing server citation formatter was extracted to `server/src/sentencias/utils/citation-formatter.ts` and remains the single formatter used by public and internal judgment views. It keeps the institutional component order (parties, Sala, date, expediente, decision number), omits missing optional fields, respects a stored custom citation, and formats dates in `es-AR` with an explicit UTC time zone for deterministic output. Original source metadata remains separate from the generated citation text.

## Query explanation and help

`GET /api/public/busqueda/interpretacion` uses the shared server parser and returns only a concise Spanish explanation and normalization note. It does not return an AST, OpenSearch DSL, analyzer details, or telemetry. The help dialog documents plain lexical-prefix terms, exact quoted words and phrases, supported `%` forms, AND/OR/exclusion, fields, filters, accent tolerance, and the distinction between `ñ` and `n`.

The explanation is derived from the same parser AST used by search. It does not alter interpretation, ranking, or search results.

## Saved public searches

**Decision: implemented without a migration.** The existing `BusquedaGuardada` JSON field stores a versioned discriminator `{ kind: "consulta-publica", version: 1, state }` with only recognized query/filter/sort/page values. It stores no result IDs, snapshots, PDF copies, or analytics. The existing endpoint and service scope every CRUD operation by the authenticated owner and restrict access to `ADMIN`/`OPERADOR`.

The saved-search screen recognizes this discriminator and opens `/consulta` with validated, allowlisted state. Existing administrative saved searches keep their prior `/sentencias` execution behavior. Unsupported or legacy JSON never becomes a public search URL.

## Existing capability audit

| Capability before Sprint 1 | Status | Decision |
|---|---|---|
| URL-encoded public query/filter/sort/page | Complete | Preserve and add canonical copy action |
| Return from a judgment to the same result state | Complete | Preserve and add browser-history coverage |
| Favorites elsewhere in the application | Partial | Reuse in public result cards |
| Saved searches in the application | Partial | Reuse the private JSON model/API for versioned public state |
| Copy link on public judgment detail | Partial | Add robust search-link copying; citation adds a stable detail URL |
| Copy citation on detail | Complete | Reuse server-authoritative citation value from cards |
| Search help | Partial | Correct and expand the used public help dialog |
| Query explanation | Missing for public use | Add parser-backed Spanish endpoint and disclosure |

## Privacy, safety, and validation

Saved queries remain owner-private and are not emitted as telemetry. Public search text remains in the public URL/search request by design; this feature does not add a second query log. No database migration was created or applied. Feature tests use synthetic browser API responses and parser/formatter unit fixtures; they do not write to principal PostgreSQL or OpenSearch.

Validation: client typecheck/lint/Node tests/build passed; the focused isolated Playwright suite passed 3/3 at 390×844, 768×1024, 1366×768, and 1920×1080. Server typecheck/lint/build and Prisma validation passed; the safe Jest suite passed 405 tests with 10 tests/1 suite skipped behind opt-in integration gates. The parser and citation formatter unit specs passed 9/9. The documented live search totals (4,759 / 3,369 / 1,826 and the 7,694 ASC/DESC golden) were not re-run: the local API at `127.0.0.1:4000` was not listening, and the synthetic golden integration suite is an opt-in DB-writing test. This sprint made no change to search execution, so these are retained as historical references rather than newly certified results.

Benchmark traceability: Q01–Q06 are ideas only; this implementation was developed independently for Galilei’s existing routes, ACL, parser, and citation conventions.

## GALILEI-POST-UAT-PRODUCT-EVOLUTION-5-SPRINTS-1

This cumulative feature candidate starts at `5869616156927a9f8f6ff220e33e9a711586dbe6` on `feature/post-uat-research-suite-1`. It includes the prior Search continuity and local PDF.js viewer-search slices, then adds private research collections, same-query public facets and a separate decision-date feed, and an editorial citation-candidate workflow. It is not deployed or promoted; `origin/dev` remains the frozen UAT SHA and `origin/main` is unchanged.

Collections keep owner-private references and plain-text notes without duplicating PDFs. Add, rename, search, note, remove, and delete operations scope to the authenticated owner; only active published judgments can be added or returned. Public facets use the current jurisprudence query and active filters, while the two public lists distinguish `publishedAt` from `Sentencia.fecha`. Citation extraction is bounded to an explicitly requested source judgment, recognizes year-qualified explicit identifiers only, and stores detections as candidates. Only an editorial reviewer can verify a candidate, and public output requires both ends to remain published and active.

The new Prisma migrations passed both an additive-upgrade run and a fresh run across all 33 migrations in disposable PostgreSQL 16.15 databases on `127.0.0.1:55434`. No feature migration or synthetic product data was written to the principal database or OpenSearch. The principal Search and PostgreSQL checks were read-only. Search parser, ranking, result ordering, and index mappings were not changed; the known live Search golden values were not re-run for this candidate.

Validation for the combined candidate: client/server typecheck and lint passed; the full workspace suite passed 421 server tests plus 14 client unit tests; the isolated research Playwright suite passed 13/13, including mocked Search-state restoration, PDF match navigation, collections/notes, facets/latest semantics, citation review, a `LECTOR` role check that confirms collection access does not grant favorite permissions, denial of the reviewer route before queue loading, and four viewport sizes. Workspace build passed. Ten server tests remain skipped behind existing opt-in integration gates. This does not represent human UAT, corpus-wide citation accuracy, or product approval; those remain separate review decisions.
