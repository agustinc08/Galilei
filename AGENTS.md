# Instrucciones del proyecto

> **Contexto vigente (2026-10-18):** INT-1R pasó y la promoción separada fue verificada: `origin/dev` y `origin/integration/galilei-beta` apuntan a `111bc5c86faff0bf946ef5e199b4463fe8217d5a`. `feature/ux-reconcile` parte de ese DEV y contiene trabajo UX todavía separado; no promover UX a DEV en esta misión. `main` y las ramas UX de entrada permanecen intactas. UAT institucional y preproducción siguen pendientes. Los estados PARTIAL/NOT PROMOTED posteriores conservan su alcance y fecha históricos; para el estado vigente consultar `docs-integracion/BJC-ESTADO-ACTUAL.md` y `BJC-ROADMAP.md`.


## Versionado Git

- El trabajo cotidiano se realiza en la rama `dev`; `main` representa estado estable.
- No versionar corpus físico, PDFs documentales masivos, backups, bases locales, recovery ni secretos; conservar fixtures sintéticos pequeños necesarios para tests.
- `_recovery-work/` y demás carpetas de recuperación nunca son fuentes versionadas.
- Evitar exclusiones globales por nombres genéricos de directorio (por ejemplo `logs/`, `data/`, `storage/` o `build/`) que puedan coincidir con código fuente. Ignorar rutas runtime concretas y comprobar `git check-ignore -v` antes de excluir archivos bajo `src/`.

Para cualquier trabajo de adquisición de fallos, leer primero `docs-integracion/BJC-ADQUISICION-JURISPRUDENCIA.md` y actualizar ese master. Los informes numerados 146–158 son evidencia histórica; no repetir auditorías cerradas ni crear informes rutinarios nuevos.

Antes de auditar, investigar o modificar Buscador Jurídico Civil, leer `docs-integracion/BJC-START-HERE.md`.

## Stack y rutas

- Frontend Jurisprudencia: `JurisprudenciaN/front` — Next.js, React, TypeScript, pnpm.
- Backend Jurisprudencia: `JurisprudenciaN/back` — NestJS, TypeScript, Prisma, pnpm.
- Base objetivo de desarrollo: PostgreSQL 16 nativo, loopback `127.0.0.1:55432`, DB `buscador_juridico_civil_dev`; el estado de instalación se registra en `docs-integracion/BJC-ESTADO-ACTUAL.md`.
- Documentación maestra: `docs-integracion/BJC-*.md`. Evidencia histórica: informes numerados en esa carpeta.

## Límites operativos

- Nunca conectarse a producción, servidores institucionales o bases remotas para desarrollo.
- Antes de cualquier escritura en DB, verificar host `127.0.0.1`, puerto `55432` y DB `buscador_juridico_civil_dev`.
- En el backend, ejecutar operaciones Prisma, fixture y pruebas PostgreSQL mediante `node scripts/with-dev-db-guard.cjs <acción>` desde `JurisprudenciaN/back`; el guard valida también el rol `bjc_dev`. No leer ni imprimir `.env.development.local`.
- Acciones del guard para Corpus: `corpus-package`, `corpus-package-tests`, `corpus-tests`, `sprint148-ingest-preflight` (sólo lectura), `sprint148-ingest` (ingesta reanudable del set seguro Sprint 14.8) y las acciones `institutional-*` documentadas por Sprints 8–9.
- Acciones del guard: `prisma-generate`, `prisma-migrate-status`, `prisma-migrate-deploy`, `schema-verify`, `fixture-import`, `benchmark`, `profile-performance`, `profile-after`, `profile-suffix-match`, `profile-identifier`, `explain`, `explain-before`, `explain-after`, `postgres-tests`, `postgres-parity`, `corpus-tests`, `corpus-package-tests`, `search-smoke`, `institutional-backup`, `institutional-associations`, `institutional-ingest`, `institutional-classify`, `institutional-classification-evaluate`, `institutional-status`, `institutional-search-smoke`, `institutional-search-explain`, `institutional-reconcile`, `institutional-associations-reconcile`, `sprint9-postgres-tests`, `sprint10-postgres-tests`, `sprint10-digesto-scan`, `sprint10-digesto-import`, `sprint10-acceptance-seed`, `sprint10-ocr-ground-truth`, `institutional-incremental`, `institutional-ocr-pilot`, `civil-pilot-verify`, `sprint148-audit` (sólo lectura de PostgreSQL DEV para conciliación y snapshot), `sprint148-ingest-preflight` (precondiciones sin escritura), `sprint148-ingest` (escritura reanudable del set seguro Sprint 14.8), `sprint148-parity`, `sprint148-search-term-after`, `sprint148-search-phrase-after`, `sprint148-explain`, `sprint148-viewer-smoke`, `sprint-j9-readonly-audit` (sólo lectura), `sprint-j9-postgres-tests` (fixtures sintéticos con limpieza), `sprint-j901-eligibility` (sólo lectura desde manifiesto J8 y PostgreSQL DEV), `sprint-j901-publication-dry-run` (sólo lectura), `sprint-j901-publication-apply` (subconjunto aprobado del manifest J8), `sprint-j901-demote-collisions` (sólo workflow J9; preserva Corpus y archivos), `sprint-j901-find-synthetic` (sólo lectura), `sprint-j901-cleanup` (sólo residuos sintéticos exactos con hashes), `sprint-j901-api-benchmark` (sólo lectura HTTP loopback), `test` y `build`.
- Los fixtures de tests Corpus deben ser sintéticos. Una misión explícitamente autorizada puede inventariar/ingestar roots locales declarados en configuración, siempre read-only, con hash/procedencia y DEV guardado. Nunca acceder a roots/servidores institucionales remotos sin canal autorizado. La búsqueda Corpus mantiene ACL antes del conteo/resultados.
- Los roots institucionales de PDFs se tratan siempre como fuentes READ-ONLY: procesos Corpus nunca deben mover, renombrar, sobrescribir ni borrar originales. Copias derivadas sólo mediante storage content-addressed.
- La línea base de Misión 7 restringía rutas PDF CSJN/CIJ disallow. Sprint 14.2 autorizó explícitamente comprobar el botón TFN histórico normal y su redirect público observado: POST `scp/include/showFile.php` con `flid`, luego GET same-site `/adj/fallos/`. Sólo usar ese flujo transparente, secuencial y con delay; detener y registrar 403/429/CAPTCHA, nunca sortearlos ni usar endpoints alternativos. CIJ mantiene sus restricciones previas. El buscador TFN actual tiene `cap-widget`; no automatizar búsqueda ni resolver el desafío. Detalles y checkpoint en `BJC-ADQUISICION-JURISPRUDENCIA.md`.
- Sprint 14 confirmó además que CIJ prohíbe `/sentencias.html`, `/d/` y `/scp/d/`; su sitemap permitido apunta a `cij7.test:8081`, que nunca debe sustituirse por un host institucional. Datos Abiertos CSJN prohíbe `/api/` y `/revision/` y declara `Crawl-Delay: 10`; usar sólo páginas públicas con ese intervalo. No resolver reCAPTCHA ni tratar un `robots.txt` que responde HTML como permiso de crawling. Los tomos de Secretaría son recopilatorios: no etiquetarlos como sentencias Civiles ni ingerirlos como un caso sin segmentación y procedencia adecuadas. Ver docs 146–158.
- Misión 7.1 implementa en DEV el canal de paquete institucional y búsqueda/lectura federadas. ZIP debe extraerse de forma segura antes de entregar carpeta; no ingerir paquetes externos sin autorización ni marcar documentos PUBLIC sin revisión ACL. Sprint 8 incorporó roots locales read-only en DEV; ver informes 53–60. Las rutas públicas CSJN/CIJ siguen NO GO.
- Misión 5.4 aprobó GO para continuar la integración del adapter en desarrollo. No tratarlo como certificado productivo: acordar SLO y validar corpus institucional y concurrencia antes de producción.
- No usar Docker ni WSL para la fase actual. PostgreSQL nativo es el entorno acordado.
- Usar pnpm según `packageManager`; no regenerar lockfiles con npm.
- SQLite histórica es referencia/fixture y se abre read-only, immutable y query-only. Excluir `tb_microisis` de importaciones automáticas.
- No versionar secretos ni incluirlos en informes. No alterar datos productivos.

## Continuidad

- No repetir auditorías cerradas ni redescubrir hechos registrados en los documentos maestros. Reabrir un punto sólo si el código/datos actuales contradicen explícitamente la documentación.
- Si hay contradicción, registrar evidencia, documento desactualizado, nueva decisión y corrección.
- Al finalizar cada misión, actualizar `BJC-ESTADO-ACTUAL.md` y `BJC-ROADMAP.md`; actualizar decisiones, mapa o fuentes si cambian.
- Distinguir siempre CONFIRMADO, IMPLEMENTADO, DISEÑADO, PENDIENTE, HIPÓTESIS y BLOQUEADO.

- Sprint 9 local boundaries: Digesto legacy roots/endpoints remain excluded unless an authorized export and ACL/identity crosswalk are supplied. Do not infer cross-domain IDs or publish Corpus content from editorial selection.
- institutional-incremental scans only configured local read-only roots, retains missing records, and runs only through the DEV guard. institutional-ocr-pilot is limited to the deterministic approved 20-file sample, stores derived text separately and never overwrites originals. Do not expand OCR without reviewed quality evidence.
- sprint9-postgres-tests may create only synthetic records in the guarded DEV database; the integration suite must clean them.
- Sprint 9 acceptance status and known limitations are in docs-integracion/70-RESULTADO-SPRINT-9.md. Never present DEV implementation as institutional acceptance or production approval.
- Sprint 10 local Digesto PDFs are imported in DEV as `DIGESTO_LOCAL` with INTERNAL visibility. No legacy metadata export/crosswalk was found; do not infer IDs, topics, tags, ownership, publication, or ACL from filenames. Do not connect to Digesto remote or institutional systems.
- Sprint 10 acceptance credentials live only in `_recovery-work/sprint10/acceptance/credentials.json`, ACL-restricted and unversioned. Never print, copy, or commit secrets. Authenticated PostgreSQL E2E uses the `sprint10-postgres-tests` DEV guard action and must clean synthetic fixtures.
- Sprint 10 OCR ground truth is not sufficient to expand OCR: CER/WER and page outliers are documented in `75-VALIDACION-OCR.md`; preserve original PDFs and require reviewed quality evidence before processing more files.
- Incremental delta classification is tested on synthetic fixtures. Real roots remain read-only; missing source records must be retained and reviewed, not deleted.
- Pilot security limits: JWT in localStorage, no endpoint rate limiting/refresh-revocation, local-only environment. Do not expose to a shared network or describe as production-ready until session, rate-limit, monitoring, concurrency, ACL, and institutional acceptance gates are resolved.
- Batch review classifications, Digesto membership and Jurisprudencia send-to-review have per-document audit and previews on the latter two. Do not imply a generic undo exists; only supported operations with explicit inverses may be reversed.
- Sprint 11: technical readiness is `NOT READY FOR PREPRODUCTION` until search latency/concurrency and isolated backup restore gates are fixed; see `docs-integracion/87-RESULTADO-SPRINT-11.md`. Do not expose the local pilot on a shared network.
- Search profiling is opt-in outside production (`BJC_SEARCH_PROFILE=true`) and logs/reports must not store query text or document excerpts. Adapter SQL statement timeout defaults to 4 s, max 4.5 s, under the 5 s federation timeout.
- Rate limiter is per-process memory and is not valid as distributed protection for multiple replicas; configure real production origins, TLS, proxy/IP and shared limiting before deployment.
- A development dump is not a restore test. Never restore over the main DEV database. `bjc_dev` currently lacks CREATEDB; use only a separately provisioned temporary DB after verifying exact local target and privileges. Windows App Control blocked `pg_restore.exe` during Sprint 11.
- Sprint 11 OCR PSM 4 improvement applies only to two measured pages. Do not update persisted extraction or expand OCR without human visual review and authorized quality sample.
- Batch Digesto membership and batch Jurisprudencia review require preview and per-document results; classification reversal returns to SUGGESTED and must append an audit event, never erase history.
- UAT remains `PENDING HUMAN ACCEPTANCE` until real users complete `79-UAT-PILOTO-USUARIOS.md`; E2E accounts are synthetic DEV identities.

- Sprint 15 adds private document workspaces on the same Corpus/Search: always require active workspace membership; global ADMIN does not imply document access. General Corpus metadata/search must enforce `documentScope=GENERAL`; private SQL must constrain `PRIVATE_WORKSPACE` and the authorized workspace before count/page/snippet. Workspace PostgreSQL tests run only through `node scripts/with-dev-db-guard.cjs sprint15-postgres-tests` or `sprint15-full-tests`.
- Sprint 15 DEV migration: `20261013130000_sprint15_private_document_workspaces`. Do not reindex the general Search projection for this additive scope column; use the existing DEV DB guard for Prisma generate/validate/status/deploy and keep workspace fixtures synthetic.
- Sprint J9.0.1 publication is a DEV-only, eligibility-gated workflow. It published 6,014 of 6,070 certified J8 cases and left 56 ambiguous/collision cases unpublished. Legacy Corpus visibility remains INTERNAL; do not infer PUBLIC access from J8 certification or widen Workspace ACL. Use the J9.0.1 scripts only through exact guard actions. Synthetic cleanup requires exact IDs, synthetic filename, matching SHA/storageKey, zero workspace refs, and removal limited to those records; never delete source PDFs or run a global projection rebuild. J9 CLOSED in DEV does not authorize preproduction/production; see `docs-integracion/BJC-OPERACION-JURISPRUDENCIA.md`.
- Sprint 15.4A.1 local OCR/DOC fixtures and Workspace E2E data are synthetic only. Run the suite through `sprint15-full-tests`, source integration through `sprint152-source-tests`, E2E cleanup through `sprint154a1-e2e-cleanup`, and the narrowly scoped orphan-residue audit/cleanup through `sprint154a1-residue-audit` / `sprint154a1-residue-cleanup`; all DB actions require the DEV guard and exact loopback identity.
- Sprint 15.6.1 personal/restricted ACL fixtures and OCR queue/storage isolation remain synthetic; run DB suites only through the matching `sprint1561-*` actions in `with-dev-db-guard.cjs`. Do not infer privacy from global role; use the shared workspace ACL contract for Search, counts, folder names, metadata, Viewer, and download.
- Sprint INT-1 integration and migration replay use only the exact PostgreSQL instance on `127.0.0.1:55432`; never touch ports 5432/5433. Keep temporary database names explicitly allowlisted in the guard, take a verified DEV backup before applying combined migrations, and leave `origin/dev` unchanged unless every critical INT-1 gate passes.


- Sprint 12 confirmed `TECHNICAL PREPRODUCTION — NOT READY`: Search/concurrency remain blocking; `pg_restore` was blocked by Windows App Control and `bjc_dev` has no CREATEDB, so never restore over main DEV or claim recovery/migration-from-zero validation. Keep DEV local only; see `docs-integracion/97-PREPRODUCTION-GATE.md` and `98-RESULTADO-SPRINT-12.md`.
- Sprint 12 added guard actions for search baseline/after, EXPLAIN, backup verification, DB preflight and concurrency. Any DB-facing action must remain behind `scripts/with-dev-db-guard.cjs` and exact local DEV identity validation.
- Sprint 12.2 `CorpusSearchToken` is a derived read model, never a legal source of truth. Enable token candidate search only after the DEV-guarded `search:verify` passes; keep `search:rebuild`, `search:verify`, and `search:repair` behind the DEV DB guard, never rebuild on startup, and preserve exact text fallback while readiness is false.
