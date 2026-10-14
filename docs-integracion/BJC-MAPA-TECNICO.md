# Mapa técnico

**Actualizado:** 2026-10-08 tras Sprint 12. Rutas locales absolutas bajo `C:\proyecto triple`.

| Componente | Ruta / dirección | Estado |
|---|---|---|
| Workspace | `C:\proyecto triple` | Raíz del proyecto local; no es una raíz Git coordinadora. |
| Backend Jurisprudencia | `C:\proyecto triple\JurisprudenciaN\back` | NestJS / TypeScript / Prisma / pnpm. |
| Frontend Jurisprudencia | `C:\proyecto triple\JurisprudenciaN\front` | Next.js / React / TypeScript; búsqueda federada, Corpus admin y viewer en Sprint 8. |
| Parser / AST | `back\src\busqueda\utils\search-parser.ts`; `search-ast.ts` | Compartido entre adapters. |
| Contrato | `back\src\busqueda\adapters\search-source.adapter.ts` | `SearchSourceAdapter`, contexto/resultados; `scoreComponents` opcional. |
| SQLite adapter | `back\src\busqueda\adapters\legacy-sqlite-search.adapter.ts` | Referencia legacy, read-only/immutable/query_only. |
| PostgreSQL adapter | `back\src\busqueda\adapters\postgres-jurisprudencia-search.adapter.ts` | Integrado en fan-out aditivo del endpoint vía `FederatedSearchService`; producción sujeta a ACL institucional, volumen/SLO. |
| Prisma | `back\prisma\schema.prisma`; `back\prisma.config.ts` | PostgreSQL; Client 7.8.0. 13 migraciones aplicadas en DEV; migración S8 añade GIN trigram a carátula normalizada. |
| Corpus pipeline | `back\src\corpus\`; `back\scripts\dev\ingest-institutional-pdfs.ts` | 10.732 documentos reales locales DEV; extraction/pages, source provenance, checkpoint/resume, asociación y clasificación RULE. Originales read-only. |
| Roots e inventario | `back\scripts\dev\institutional-pdf-roots.json`; manifest bajo `_recovery-work\sprint8\inventory\1a063011-f3a3-421f-bd11-1ecdf3896bb2` | Tres roots Jurisprudencia activos/read-only, 23.829 ubicaciones, SHA de manifest en docs 53/60; 278 PDFs Digesto excluidos. |
| Corpus Search | `back\src\corpus\corpus-search.adapter.ts` | `SearchSourceAdapter`; ACL en WHERE, snippet/procedencia/página; searchText normalizado y GIN trigram, fan-out desde `FederatedSearchService`. |
| Paquete institucional | `back\src\corpus\document-ingestion-package.ts`; `back\scripts\dev\corpus-package.ts` | Manifiesto JSON/CSV/carpeta, validación/hash, draft, dry-run, import, retry/status, receipt JSON/SHA/MD; sólo DEV guardado. ZIP requiere extracción previa. |
| Search federado | `back\src\busqueda\federated-search.service.ts` | Fan-out paralelo con timeout, filtro de fuentes, paginación estable y dedupe por links; salida aditiva `federated`. |
| Lectura/descarga Corpus | `back\src\corpus\corpus-document-access.service.ts`; controllers/module | ACL antes de metadata/archivo, rutas públicas/auth, PDF/TXT, Range, nombre seguro. No publicar sin revisión institucional. |
| Corpus fixtures | `back\scripts\dev\fixtures\corpus\`; generador en `back\scripts\dev\create-corpus-fixtures.cjs` | Seis archivos sintéticos; no contiene documentos institucionales. |
| Corpus storage DEV | `C:\proyecto triple\_dev-corpus-storage` (configurable por `BJC_CORPUS_STORAGE_PATH`) | Fuera de PostgreSQL, clave SHA-256; suite usa una raíz temporal aislada `_dev-corpus-storage-test`. |
| Panel y visor Corpus | `front\src\app\(admin)\corpus\`; `front\src\app\(admin)\busqueda-avanzada\page.tsx` | Resultados, filtros/cola, metadata/procedencia, visor PDF, salto de página, contexts y navegación matches. No pinta resaltado dentro del PDF ni tiene batch review. |
| Operación Sprint 8 | `back\scripts\dev\institutional-run-status.ts`; `institutional-search-smoke.ts`; `explain-institutional-search.ts`; `evaluate-institutional-classification.ts` | Estado, idempotencia, Search real y evaluación de muestra; todas las escrituras a DB pasan por guard. |
| Guard DEV | `back\scripts\with-dev-db-guard.cjs` | Sólo acepta `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`; incluye ingest/status/classify/search-explain/evaluate, migraciones y suites. |
| Guard runtime | `back\src\prisma\create-prisma-client.ts` | En entornos no productivos rechaza cualquier otra URL. |
| Fixture fuente | `C:\proyecto triple\_legacy-audit-work\extracted\jurisprudencia\jurisp_6\db\jurisprudencia_db.sqlite` | Única fuente que reprodujo benchmark legacy; 21.109/25.139 filas en tablas de búsqueda; excluir 1 sumario huérfano. |
| Importador DEV | `back\scripts\dev\import-search-fixture.ts` | Determinista, upsert transaccional; no consulta MicroISIS. |
| PostgreSQL DEV | `127.0.0.1:55432`, DB `buscador_juridico_civil_dev`, usuario `bjc_dev` | 16.15; loopback; `pg_trgm 1.6`; sin secreto documentado. |
| Config local | `back\.env.development.local` | Ignorado por Git, ACL local; no leer/volcar a logs o Markdown. Nest prioriza este archivo. |
| Benchmark original | `docs-integracion\benchmark-busqueda.json` | 55 casos; intacto. |
| Evidencia M5.3–5.4 | Informes `29`–`35` y sus JSON | Fixture, adapter, paridad, baseline, planes y gate de performance. |
| Evidencia M6 | Informes `36`–`40` | Modelo, pipeline, extracción, Search y dictamen GO con ajustes. |
| Evidencia M7 | Informes `41`–`46` | Superficies oficiales CSJN/CIJ, alcance Civil, restricción robots, piloto no ejecutado y dictamen NO GO para descarga automática. |
| Evidencia M7.1 | Informes `47`–`52` | Canal institucional de paquete, Search federado, ACL, pruebas DEV y gates pendientes. |
| Evidencia Sprint 8 | Informes `53`–`60` | Inventario, ingesta, asociaciones, OCR, clasificación, Search, viewer y dictamen. |
| Informes previos | `docs-integracion\01-28-*.md` | Preservados; leer informes 29–32 para resultados posteriores. |

## Acciones con escritura

Desde `JurisprudenciaN\back`, ejecutar únicamente acciones admitidas por `node scripts\with-dev-db-guard.cjs <acción>`. El guard verifica host, puerto, base y usuario antes de lanzar; importador y verificador vuelven a comprobar la identidad desde la conexión PostgreSQL.

## Fuente oficial M7

La URL histórica CIJ redirige al buscador CSJN Tribunales Federales y Nacionales. `robots.txt` prohíbe la ruta de PDF observada. Reanudar sólo después de canal/API/export autorizado; documentación en `41`–`46`.

## Mapa añadido Sprint 9

- Prisma: entidades DigestoCollection, DigestoTopic, DigestoTag y relaciones al documento Corpus; migración 20261008100000_sprint9_digesto_taxonomy.
- Backend: corpus-curation.controller/service; rutas de asociación, clasificación individual/lote, selección editorial y catálogo/relaciones Digesto. Autorización ADMIN/OPERADOR y AccionLog.
- Search: metadatos Digesto agregados a los hits Corpus existentes; no adapter legacy dedicado.
- Frontend: shell AdminShell, /digesto, /digesto/[id], /revision y panel de curaduría /corpus/[id]; aliases documentados en informe 62.
- Dev tools: institutional-incremental-scan.ts y ocr-institutional-pilot.ts con guard DB; evidencia e informes quedan en _recovery-work/sprint9/.
- Historial de evidencia detallada: docs 61–70.

## Mapa añadido Sprint 10

- `src/main.ts`: cabeceras globales MIME sniff, frame, referrer y permissions policy.
- `src/corpus/sprint10-pilot.integration.spec.ts`: suite PostgreSQL autenticada para seis roles; acción `sprint10-postgres-tests` en guard DEV.
- `scripts/dev/sprint10-digesto-scan.ts` y `sprint10-digesto-import.ts`: scan read-only e import content-addressed; evidencia en `_recovery-work/sprint10/digesto/`.
- `scripts/dev/sprint10-acceptance-seed.ts`: seed idempotente; credenciales en archivo local ACL restringido.
- `scripts/dev/sprint10-ocr-ground-truth.ts`: CER/WER sobre raster derivado; originals intactos.
- `src/corpus/institutional-incremental-delta.ts`: clasificador NEW/MODIFIED/MISSING/UNCHANGED con fixtures.
- Frontend: `CorpusPdfViewer.tsx`, `/corpus/[id]`, filtro por colección Digesto y `tests/pilot.e2e.spec.ts`.
- Evidencia y límites: documentos `71`–`78`.

## Mapa añadido Sprint 11

- `src/rate-limit.middleware.ts`: ventanas por IP/categoría (`auth/search/matches/download`), defaults configurables, contador local de proceso.
- `src/safe-exception.filter.ts` + `src/main.ts`: `X-Request-Id`, headers, logs de ruta sin query/body, respuesta 5xx genérica y rate limit; CORS de producción sólo por env.
- `src/health/health.controller.ts` y `CorpusDocumentAccessService.storageReady()`: `/api/health/live`, `/api/health/ready`, DB y storage verificables.
- `src/busqueda/federated-search.service.ts`, `busqueda.controller.ts` y adapters: profiling opt-in; `BJC_SEARCH_STATEMENT_TIMEOUT_MS` frena SQL Corpus/Jurisprudencia en el límite configurado.
- `src/corpus/corpus-curation.controller.ts/service.ts`: endpoints preview/aplicación para batch membership y envío de Jurisprudencia a revisión; reversión auditada de clasificación. E2E PostgreSQL cubre las rutas.
- Scripts de evidencia protegida: `sprint11-search-profile.ts`, `sprint11-concurrency.ts`, `sprint11-explain.ts`, `sprint11-ocr-eval.ts`, `sprint11-viewer-audit.ts`, `sprint11-db-audit.ts`, `sprint11-backup-verify.ts`; todos operan por acción explícita/guard.
- `front/playwright.config.ts` captura screenshot sólo al fallar; `tests/pilot.e2e.spec.ts` valida LECTOR/PDF/highlight, headers/readiness, ADMIN/dashboard/logout y navegación por roles; última ejecución 4/4 PASS.
- Dictamen y artifacts: docs `79`–`87`; detalles privados bajo `_recovery-work/sprint11/`. No guardar consulta legal, credenciales ni texto OCR en reportes.

## Cambios Sprint 12

- Búsqueda avanzada acepta `digestoTopicId` y `digestoTagId`; filtros de taxonomía/colección se resuelven en Corpus. `corpus-search.adapter.ts` usa parámetros y limita IDs antes de enriquecer la página.
- `main.ts` añade warning lento configurable `BJC_SLOW_SEARCH_MS`, sin query/body; timeout `BJC_SEARCH_STATEMENT_TIMEOUT_MS` continúa acotado.
- Guard `scripts/with-dev-db-guard.cjs` incorpora acciones diagnósticas Sprint 12. Artefactos sanitizados en `_recovery-work/sprint12`; informes 88–98.
- Estado DEV real: 14 migraciones. Restore/migración vacía están bloqueados, no certificados. Dictamen NOT READY.

## Cambios Sprint 12.1

- `src/busqueda/busqueda.service.ts` evita el COUNT duplicado para texto en el modo legacy; filtros sin texto conservan el conteo exacto.
- `src/prisma/search-query-telemetry.ts`, `src/prisma/prisma.service.ts`, `src/busqueda/busqueda.controller.ts` y `src/busqueda/federated-search.service.ts` agregan perfiles y fingerprints sin guardar SQL, parámetros ni texto.
- `src/corpus/corpus-search.adapter.ts` instrumenta consulta COUNT/PAGE y pool; la evaluación de GIN por página/índice ordenado quedó revertida por EXPLAIN.
- `scripts/dev/sprint121-*.ts`, `scripts/with-dev-db-guard.cjs` y `scripts/with-sprint121-temp-db-guard.cjs` contienen benchmarks, EXPLAIN sanitizado, backup/restore y migración de DB temporal. El guard DEV general no acepta targets alternativos.
- DEV pasó a 17 migraciones tras los experimentos versionados y la migración de cleanup; 17/17 aplicadas. Restore y migrate-from-zero fueron certificados en DB temporales, luego eliminadas por guard.
- Resultado NOT READY y mediciones en docs 99–106; artifacts sanitizados bajo `_recovery-work/sprint121/`.


## Mapa Search V2 — Sprint 12.2 (2026-10-08)

- AST/parser: `JurisprudenciaN/back/src/busqueda/utils/search-parser.ts` y `search-ast.ts`.
- Candidate sets Juri: `src/busqueda/adapters/postgres-jurisprudencia-search.adapter.ts`; ruta legacy visible aún en `src/busqueda/busqueda.service.ts` y es el cuello API medido.
- Corpus candidate executor, token projection/readiness y late hydration: `src/corpus/corpus-search.adapter.ts`, migraciones `20261008210000_corpus_search_token_projection` y `20261008220000_corpus_search_projection_readiness`.
- Operación: `scripts/dev/sprint122-search-projection.ts`, siempre bajo `scripts/with-dev-db-guard.cjs`; nunca reconstruir al startup.
- Instrumentación: `scripts/dev/sprint122-explain.ts`, benchmark adapter Corpus, benchmark API y concurrencia bajo `scripts/dev/`.
- Evidencia JSON: `_recovery-work/sprint122/{projection,plans,parity,semantic,performance,backups}/`.
- Estado de readiness técnica y limitaciones: docs 111–116; TECHNICAL PREPRODUCTION NOT READY.

## Hot path vigente — Sprint 12.3 (2026-10-08)

- UI request: `JurisprudenciaN/front/src/app/(admin)/busqueda-avanzada/page.tsx` → `api.get('/busqueda/avanzada')`.
- Route: `BusquedaController.avanzada()` decide capacidades. Familias estándar: V2 only, convierte resultados V2 al shape `data`/`meta`, añade `federated`, y mantiene `trackAdvancedV2`; filtros no cubiertos: fallback hybrid. Perfil DEV muestra `engine` por fuente, nunca a UI normal.
- V2: `FederatedSearchService.search()` → `PostgresJurisprudenciaSearchAdapter` (`Sumario`/`Sentencia`) y `CorpusSearchSourceAdapter` (`CorpusSearchToken` candidatos, `CorpusDocument`/extracción late hydration). `SearchQueryAst` proviene del parser compartido.
- SQL relevante: candidatos por literal y set operations booleanas para Juri; Corpus con ventanas limitadas, `ILIKE` token candidato de frase + verificación exacta, prefix `LIKE`, suffix `reverse(token) LIKE`, y `EXISTS` token para short.
- El término estándar ya no invoca `BusquedaService.avanzada`. El SQL V2 todavía puede escanear/filtrar tablas fuente; no afirmar que todo plan use índice.
- Pool Corpus `max=8`; load harness 1/5/10/20 sin errores. Prisma wait peak 123 a 20 usuarios; alcance local in-process.
- Evidencia y mapa detallado: docs 117–125; artifacts `_recovery-work/sprint123/`. Gate READY WITH NON-BLOCKING ADJUSTMENTS para paso controlado, no producción.

## Mapa de preparación Sprint 13

- Docs 126–139 contienen topology inventory, guion UAT, matriz ACL, anonimización/visibilidad, retención, plan Search/preprod, ingesta/proyección, operación, manual provisional, deploy, release notes y gaps.
- No hay aplicación ni DB desplegadas para preprod. El único endpoint PostgreSQL confirmado es DEV loopback `127.0.0.1:55432`; no se ejecutaron migraciones, ingesta de corpus ni reconstrucciones del read model durante Sprint 13.
- Las señales actuales `GET /api/health/live` y `GET /api/health/ready` están bajo `src/health/health.controller.ts`; no fueron smoke-tested en preprod. Rate limit sigue en memoria por proceso.
- `src/config/preprod-config.ts` ahora valida fail-closed destino DB declarado, secret/expiry, CORS HTTPS, storage separado, rate limit y timeout antes de Nest en `BJC_DEPLOYMENT_ENV=preprod`; suite sintética `preprod-config.spec.ts`. Aún requiere prueba en host autorizado; logger no consume `LOG_LEVEL` y limitador es por proceso.
- `scripts/with-preprod-db-guard.cjs` permite `check`, `migrate-status` y `migrate-deploy`; compara la DB aprobada antes de Prisma. `check` no conecta. Sin destino real no se ejecutó status ni deploy.
- Runbook de despliegue está condicionado a host, DB/storage, configuración y políticas institucionales; no copiar env DEV.

## Bootstrap preprod — Sprint 13.1

- Paquete documental compacto: docs 140–145. Informe de resultado: ambiente no disponible, BLOCKED / NOT EXECUTED.
- `src/config/preprod-config.ts` rechaza DB loopback además de DEV y valida la identidad declarada, HTTPS, JWT, storage/rate-limit/timeout.
- `scripts/with-preprod-db-guard.cjs` conserva `check` sin conexión y verifica identidad efectiva antes de status/deploy, `db-report` read-only y proyección `rebuild|verify|repair`; nunca usar la proyección DEV contra preprod.
- `scripts/backup-preprod.ps1` crea dump/storage archives y manifiesto hash-verificado; `scripts/deploy-preprod.ps1` valida ese manifiesto y requiere script institucional para iniciar servicios. No se ejecutaron en ausencia de host.
- `front/scripts/preprod-load-smoke.mjs` prepara olas de 1/5/10 con credencial aprobada, autorización de ventana y reporte separado; no usar harnesses de concurrencia DEV contra preprod.
- `front/playwright.preprod.config.ts` y `front/preprod-tests/bootstrap-smoke.spec.ts` exigen target HTTPS, aprobación, credenciales/ID aprobados y escriben reporte sanitizado. No son UAT humana ni se ejecutaron contra preprod.

## Espacios documentales privados — Sprint 15

`WorkspaceDocumentController` expone Mi espacio, carpetas, membership, PDF upload, Search y viewer. `WorkspaceDocumentService` centraliza roles ACL, ingestión, membership y auditoría; `CorpusDocumentAccessService` exige scope general o workspace exacto para metadata/matches/file. `CorpusSearchSourceAdapter` añade la restricción de scope en CTE elegible y predicados SQL de conteo/página. La ruta general fija `documentScope=GENERAL`; la ruta privada usa el mismo parser, federador y adapter con `documentScope=WORKSPACE` tras autenticar membership. Prisma y migración: `DocumentDependency`, `DocumentWorkspace`, `WorkspaceMembership`, `WorkspaceFolder`, `WorkspaceDocument` y `CorpusDocument.documentScope`. UI: `front/src/app/(admin)/spaces/` y viewer workspace que reutiliza `CorpusPdfViewer`.

## Fuentes de carpetas UNC — Sprint 15.2

`DocumentSourceController` (`workspaces/:workspaceId/sources`) delega en `DocumentSourceService`; cada operación comprueba membership activa ADMIN explícita. `DocumentSourceScanner` valida la raíz UNC y enumera archivos evitando enlaces/reparse points. El servicio compara metadata, calcula SHA cuando corresponde, ingiere PDF por `WorkspaceDocumentService`, reconcilia rename/missing sólo tras enumeración completa y mantiene runs/counters en `SourceScanRun`. Prisma: `DocumentSource`, `SourceFile`, `SourceScanRun` y enums de estado; migración `20261013170000_sprint152_document_sources`. La identidad del proceso backend provee acceso SMB; no hay credenciales guardadas. UI de fuentes en `front/src/app/(admin)/spaces/`; la Search privada añade alias de fuente sin retornar la ruta.

## Extracción de documentos — Sprint 15.4A

`DocumentFormatDetector` valida firmas PDF/OLE/RTF/ZIP y la estructura DOCX/ODT. `SafeZip` aplica límites de tamaño, expansión, entradas, CRC, rutas y cifrado; `DocumentOfficeExtractors` extrae RTF/OOXML/ODF sin ejecutar aplicaciones ni buscar relaciones externas. `BasicDocumentTextExtractor` conserva extracción PDF/TXT y entrega provenance, advertencias y páginas candidatas a OCR. `CorpusIngestionService` y `WorkspaceDocumentService` persisten el MIME detectado y la provenance sin migración. `CorpusDocumentAccessService` sirve preview/archivo bajo ACL para MIME admitidos. DOC se detecta, pero falla cerrado sin extractor. No hay motor ni worker OCR instalado; ver matriz y límites en `BJC-PROCESAMIENTO-DOCUMENTAL.md`.
