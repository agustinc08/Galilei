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

## Sprint 15.1 — UX, administración y UAT técnico (2026-10-13)

La UI de `Mi espacio` ahora muestra el nombre/tipo de la dependencia, el rol y el alcance de búsqueda; usuarios con un espacio entran directamente y usuarios multi-espacio cambian mediante selector. Usuarios sin membresía reciben un estado vacío claro. Carpetas tienen ruta y navegación de raíz, búsqueda puede limitarse a carpeta actual o abarcar todas, y existe búsqueda privada por nombre de archivo. Resultados y documentos recientes presentan nombre, fragmento/página, carpeta, fecha, cargador y estado traducido. El viewer privado preserva el contexto de vuelta y usa endpoints protegidos.

La carga acepta selección o drag-and-drop, hasta 20 PDFs, con resultado independiente por archivo y errores legibles. El flujo fue ejercitado con 1, 5 y 20 archivos, PDF corrupto y duplicado; el mismo contenido en espacios distintos conserva la separación lógica. ADMIN de workspace puede buscar/agregar miembros, cambiar rol, desactivar/reactivar miembros, organizar carpetas y consultar actividad. Admin Galilei puede crear/listar/activar/desactivar espacios y ver sus administradores; estos permisos globales no conceden lectura de sus documentos. Se impide dejar un espacio sin administrador activo.

| Perfil/flujo sintético | Resultado |
| --- | --- |
| Admin Galilei, crear y administrar espacios A/B | PASS |
| Admin de espacio, miembros, roles, carpetas y actividad | PASS |
| Editor, organización y carga multiarchivo | PASS |
| Viewer, búsqueda, apertura y descarga protegida; controles de edición ausentes | PASS |
| Multi-espacio y cambio visible de alcance | PASS |
| Sin espacio asignado | PASS |
| A/B cruzado por resultados, metadata, viewer y descarga | PASS; 404 sin render parcial |
| Búsqueda general sin documentos privados | PASS |
| Mismo hash en dos espacios | PASS; blob físico compartido e identidades/accesos lógicos separados |

El Playwright local ejecutó 2 escenarios browser y comprobó upload 1/5/20, errores por archivo, raíz/carpeta, búsqueda por texto/nombre, viewer y denegación cruzada. Se tomaron e inspeccionaron capturas del home a 1366×768 y 1920×1080. Las cuentas y workspaces son sintéticos y la limpieza de registros/archivos temporales terminó PASS. Esto prueba la UAT automatizada local, no la aceptación de personal real de juzgados/salas; esa aceptación continúa PENDING.

### Rendimiento privado medido

Dataset sintético separado: 100, 500 y 1.000 documentos. Última corrida TERM p50/p95: 38,15/42,20 ms; 446,55/457,30 ms; 386,62/2.698,19 ms, con total exacto. PHRASE p50/p95: 141,39/143,90 ms; 413,39/418,18 ms; 297,42/312,57 ms; en 500 y 1.000 devuelve ventana parcial de 100 y no total exacto, deuda existente documentada, no se optimizó en esta Sprint. La medición SQL aislada de count ACL (no el tiempo end-to-end del endpoint) mostró delta p50/p95 de 0,84/0,93 ms (100), 59,34/66,64 ms (500) y 28,05/36,18 ms (1.000). Corridas sucesivas oscilaron hasta TERM 1.000 con p50 2,30 s y p95 2,39 s, lo que evidencia variación alta; no tratar estos valores como SLO estable. Overhead de membresía+respuesta, separado del adaptador: TERM 2,49/4,76/7,01 ms y PHRASE 2,77/6,73/6,08 ms para esos tamaños.

`EXPLAIN ANALYZE` sobre el count TERM privado sintético de 500 filas usó índice de `CorpusDocument` por scope/status y luego un nested loop ACL: 500 loops de índice `WorkspaceDocument_workspaceId_folderId_createdAt_idx`, 250 filas por loop, 124.750 eliminadas por condición de join; 81,81 ms y 3.132 shared buffers (todos hit). El plan valida aplicación en SQL y evidencia que el predicado ACL puede recorrer demasiadas filas para cardinalidades mayores; no se agregó índice en esta Sprint. El endpoint TERM devuelve count exacto, pero su p95 a 1.000 osciló hasta 2,70 s en la última corrida y el p50 entre corridas hasta 2,30 s. Perfilar esa variación antes de ampliar el corpus del piloto.

Search general quedó intacto: verificación 17.078 documentos, 18.799.500 tokens, stale=0, 0/100 discrepancias; paridad 40/40; viewer general 6/6. La suite de backend general pasó 94 tests y omitió 15. Builds y typechecks frontend/backend pasan. Sin despliegue compartido, preproducción o producción. Sprint 15.1 queda PARTIAL hasta que usuarios/owners reales registren UAT y se perfile la variación ACL/TERM observada con más escala; PHRASE exact-total/performance sigue siendo deuda independiente.
