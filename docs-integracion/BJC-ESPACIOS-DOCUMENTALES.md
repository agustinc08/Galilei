# Espacios documentales privados — Sprint 15

**Actualizado:** 2026-10-13. Alcance: MVP técnico en PostgreSQL DEV local. No implica autorización de producción, red compartida ni aceptación institucional.

## Decisión de producto

Galilei contiene dos universos documentales en la misma aplicación, PostgreSQL, Corpus y Search:

- **GENERAL**: jurisprudencia, Digesto y documentos comunes regidos por sus ACL existentes.
- **PRIVATE_WORKSPACE**: documentos de una dependencia, accesibles sólo mediante una membresía activa en su espacio.

La membresía es independiente del rol global. Ser `ADMIN` de Galilei no concede acceso implícito a ningún espacio privado. No existe promoción desde privado a general ni un scope `ALL_AUTHORIZED` expuesto en la interfaz.

## Componentes reutilizados

- `CorpusDocument` conserva texto, estado, extracción y metadatos. `documentScope` distingue `GENERAL` y `PRIVATE_WORKSPACE`; un PDF privado usa visibilidad `RESTRICTED`.
- `CorpusDocumentFile` y `LocalDocumentStorageAdapter` mantienen el SHA-256 y el almacenamiento físico content-addressed. El mismo PDF en espacios distintos tiene documentos y asociaciones lógicas separadas, y comparte el objeto físico.
- `BasicDocumentTextExtractor`, páginas Corpus, `Search AST` y `CorpusSearchSourceAdapter` proveen extracción, visor y búsqueda existentes.
- `AccionLog` registra creación de espacio, miembros, carpetas, movimientos y cargas.

## Modelo y migración

La migración aditiva `20261013130000_sprint15_private_document_workspaces` agrega `documentScope`, catálogo normalizado `DocumentDependency`, `DocumentWorkspace`, `WorkspaceMembership`, carpetas jerárquicas y vínculo `WorkspaceDocument`. Las claves/indexes cubren workspace, usuario, documento y carpeta. No reescribe documentos ni recalcula `CorpusSearchToken`.

La DEV exacta antes de migrar fue `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`. Se reutilizó el backup pre-migración verificado de Sprint 14.9: `_recovery-work/sprint149/backups/manifest-before-migration.json` (dump SHA-256 `729352e7…c0be80`, SQL UTF-8 SHA-256 `7475ef2b…37439`). Los backups permanecen ignorados y fuera del repositorio.

## Acceso y API

`WorkspaceDocumentService` concentra el control de membership/roles. Los espacios desconocidos o ajenos responden 404. `ADMIN` crea y gestiona miembros; `ADMIN` y `EDITOR` crean carpetas, mueven y cargan; `VIEWER` lee, busca y navega.

- `GET /api/workspaces/mine`
- `POST /api/workspaces` (rol global ADMIN; el creador recibe membership ADMIN)
- `GET/POST /api/workspaces/:id/folders`
- `GET /api/workspaces/:id/documents`
- `PATCH /api/workspaces/:id/documents/:documentId/folder`
- `POST /api/workspaces/:id/documents/upload` (hasta 20 PDFs de 20 MB)
- `GET /api/workspaces/:id/search`
- `GET /api/workspaces/:id/documents/:documentId`, `/matches`, `/file`
- `GET/POST /api/workspaces/:id/members`

PDF es el único formato de upload habilitado. La firma `%PDF-` se valida; el nombre original se conserva como metadato seguro y no es identidad. Se extrae texto por página y se indexa dentro del mismo scope; los PDFs `OCR_REQUIRED` se pueden leer y no se buscan por contenido. No se lanza OCR automáticamente. No se devuelven rutas locales ni URLs estáticas de blobs.

La subida es idempotente por workspace + SHA-256. Un duplicado dentro del mismo espacio se reutiliza; el mismo hash en otro espacio crea una asociación lógica independiente. El storage es content-addressed.

## Search y aislamiento

Después de validar la membresía, el servicio invoca el parser y federador existentes con `sourceSystems: ['CORPUS']` y un scope interno. El adaptador aplica `documentScope` y el `EXISTS WorkspaceDocument(workspaceId)` en la elegibilidad SQL de candidatos y en los predicados de conteo/página. Los snippets, IDs, totales, páginas y hrefs salen sólo de esa consulta autorizada. Las búsquedas generales fuerzan `documentScope = GENERAL`; los endpoints globales de metadata, matches y archivo también excluyen privados incluso para ADMIN global.

El endpoint de búsqueda no acepta un workspace como autorización: cada llamada valida membership en PostgreSQL. El `workspaceId` SQL siempre es un parámetro enlazado. No hay cache de ACL.

## Uso de UI

`Mi espacio` aparece en la navegación de roles autenticados. Muestra los workspaces asignados, carpetas, subida multi-PDF, documentos recientes, estados de extracción y búsqueda privada con snippet. El viewer valida acceso antes de obtener metadata, texto de coincidencias o PDF, y permite navegar/resaltar páginas.

## Verificación y límites

E2E PostgreSQL sintético (Sprint 15, bajo guard DEV): PASS. Verifica dos workspaces, hashes idénticos con IDs lógicos distintos, búsqueda/total independiente, Corpus general sin privados, 404 ante metadata/matches/archivo cruzados o globales, rol VIEWER sin carga/organización, carpetas y membresía explícita. Se usa el PDF sintético `scripts/dev/fixtures/corpus/fallo-fixture.pdf`; los registros se limpian al terminar.

Typecheck y builds backend/frontend: PASS. Suite backend: 94 PASS / 15 omitidos. E2E PostgreSQL Sprint 15: PASS, incluye acceso directo autorizado y denegación cruzada. Search verify: 17.078 documentos, 18.799.500 tokens, stale=0, mismatch=0/100; paridad: 40/40; viewer general: 6/6. `migrate status` limpio; `schema-verify` PASS con 49 tablas y 22 migraciones. Benchmark canónico del endpoint tras 1 warmup + 10 requests: TERM común p50/p95 202/266 ms y PHRASE 1.934/2.226 ms, fallos 0/10. Sprint 14.9.2 baseline comparable PHRASE fue 2.272/2.427 ms; mejora 14,9% p50 y 8,3% p95; PHRASE sigue sobre el objetivo histórico de 1.200 ms. En E2E, workspace sintético de 1 PDF dio TERM 3,9/5,4 ms y PHRASE 86,6/176,6 ms (3 muestras calientes, no SLO ni carga concurrente). Una corrida exploratoria con pocos samples llegó a `57014`; la repetición canónica 10/10 no tuvo fallos.

La eliminación física queda fuera del MVP para no borrar blobs compartidos. Retiro lógico del documento, trash/versionado, historial/versiones, búsqueda `ALL_AUTHORIZED`, OCR, compatibilidad DOC/DOCX, cuotas, administración masiva y aceptación UAT quedan para fases posteriores.

El Search PHRASE sigue con el estado PARTIAL documentado en `BJC-SEARCH.md`; Sprint 15 no implementa ni optimiza ese camino.
