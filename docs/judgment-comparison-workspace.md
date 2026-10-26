# Judgment comparison workspace

## Scope

The comparison workspace lets a researcher inspect two to four **public, active** judgments together. It is an evidence display, not an automated legal analysis. It does not identify conflicts, authority, overruling, or the relative strength or currency of a judgment.

## Product behavior

- `/comparar?ids=<slug>,<slug>` resolves canonical public slugs. The URL contains no private judgment identifier or private note.
- Search result cards, a public judgment detail page, collection items, and favorites can add or remove a judgment from the session comparison tray. The tray preserves at most four selections across in-app navigation and retains the originating path for return.
- The server enforces two to four distinct slugs and rechecks `publicado=true` and `activo=true` on every resolution. If one item is missing or no longer public, the response is a generic 404 for the whole comparison.
- The matrix displays only selected public metadata, active published sumarios, the editorial reseña only when published, and any existing published automatic summary in a separate explicitly labeled row.
- Exact same-expediente groups use `normalizeExpediente`; no fuzzy match is performed.
- Citation counts and cross-citations use only `SentenciaRelationshipCandidate.status=VERIFIED`, relationship type `CITES`, and public active source and target judgments. Candidate detections are never returned. Cross-case citation rows are capped at 500; per-judgment totals come from grouped database counts.
- Notes are read only from the signed-in owner's own collection items and are never included in the public resolution response. Users can edit them from their collection.
- The existing `PdfViewer` supplies local PDF search, outline navigation, page links, page citations, and passage-plus-citation copying. Two viewers mount only after a user opens the two-judgment deep compare. With three or four judgments, one viewer is active at a time. Page positions are independent.
- Saved comparisons store an owner, name, and ordered references to public judgment rows. Owner filters apply to list, read, rename, and delete. Deleting a comparison does not delete judgments, collections, or notes. Each operation writes a compact audit entry without note or PDF text.

## API

| Method | Route | Access | Purpose |
|---|---|---|---|
| GET | `/research/comparisons/resolve?ids=slug1,slug2` | Public | Hydrate public metadata, published sumarios, exact same-expediente membership, and verified citation relations. |
| GET | `/research/comparisons/notes?slugs=slug1,slug2` | Authenticated owner | Return only the caller's notes from personal collections. |
| GET | `/research/comparisons` | Authenticated owner | List valid saved comparisons. |
| POST | `/research/comparisons` | Authenticated owner | Save a name and two to four ordered public slugs. |
| GET | `/research/comparisons/:id` | Authenticated owner | Revalidate and reopen a saved comparison. |
| PATCH | `/research/comparisons/:id` | Authenticated owner | Rename a saved comparison. |
| DELETE | `/research/comparisons/:id` | Authenticated owner | Delete only comparison metadata and its items. |

The resolve endpoint returns an explicit DTO; it never serializes Prisma entities or filesystem paths. Only public comparisons are supported in v1. Mixed or private judgments are not accepted, and saved data is revalidated before it is returned.

## Persistence

Migration 36, `20261026140000_judgment_comparison_workspace`, adds `ResearchComparison` and `ResearchComparisonItem`. It is additive and does not alter migration 35, search mappings, the Viewer, or Suite 4 gold semantics. The item model has unique comparison/judgment and comparison/position constraints.

## Validation status

The implementation lives on `feature/judgment-comparison-suite-5`, based on Suite 4 SHA `260b017e3fa3b2f26fea60c325790712db541bac`. Local validation passed: server 586 tests (10 pre-existing skips), client 16/16, Suite 2 focused regression 41/41, and Suite 4 tooling 4/4 with human labels still `PENDING_HUMAN_GOLD`. Fresh migrations 1–36 and incremental 35→36 passed on isolated PostgreSQL. Real API/browser QA passed for two- and four-judgment comparisons, owner access, PDF behavior, return navigation, and four responsive sizes. Production and full dependency audits reported no known vulnerabilities; no dependency was added. The final report in `_recovery-work/galilei-judgment-comparison-suite5/` records the published feature SHA and CI. No promotion to DEV or `main` is part of this feature branch.
