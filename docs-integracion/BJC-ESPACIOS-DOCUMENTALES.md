# Espacios documentales — Sprint 15 / INT-1

> **Contexto INT-1 (2026-10-14):** Este contrato forma parte de Galilei integrado en la rama de integración. La interfaz presenta Jurisprudencia, Mi Sala / Juzgado y Mis documentos; Copernic queda como nombre interno. El estado global es PARTIAL y no habilita actualizar origin/dev: el snapshot local de publicación no coincide con el certificado y faltan los manifiestos J7/J8. Ver BJC-ESTADO-ACTUAL.md; los cortes y resultados históricos debajo conservan la fecha/sprint que los generó.


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

## Fuentes de carpetas de red — Sprint 15.2

Los workspaces admiten fuentes privadas UNC, escaneo en segundo plano y reconciliación incremental por ruta, metadata y SHA. La interfaz ADMIN permite crear, probar, pausar/reactivar e iniciar escaneos; Search muestra sólo el alias de origen. Los endpoints de archivos, runs y errores requieren ACL ADMIN explícita del workspace. `MISSING` no elimina documentos ni blobs. La lectura usa la identidad Windows del backend y requiere permisos SMB/NTFS; no se almacenan credenciales SMB. Especificación, límites y evidencia: `BJC-FUENTES-DOCUMENTALES.md`.

## Sprint 15.1.1 — rendimiento ACL de TERM privado (2026-10-13)

**Resultado: PARTIAL.** Se mitigó el plan ACL repetitivo mediante mantenimiento de estadísticas local, sin cambiar el modelo de acceso, el SQL de filtrado por workspace ni agregar índices. El conteo TERM sigue exacto y aislado. La meta no queda cerrada porque 1.000 documentos llegó a p95 417 ms (objetivo 400) y 5.000 documentos llegó a p95 839 ms (objetivo 800), con max/p50 4,74× en la búsqueda común. La búsqueda de cero resultados también es costosa por el conteo exacto.

| Documentos privados | TERM común p50/p95 | TERM medio p50/p95 | TERM raro p50/p95 | Cero p50/p95 |
|---:|---:|---:|---:|---:|
| 100 | 32,7 / 69,0 ms | 29,7 / 36,9 ms | 26,4 / 37,1 ms | 517,1 / 552,4 ms |
| 500 | 122,8 / 129,2 ms | 85,7 / 109,3 ms | 58,9 / 72,8 ms | 552,2 / 561,4 ms |
| 1.000 | 365,9 / 417,0 ms | 195,3 / 210,0 ms | 121,1 / 131,6 ms | 512,8 / 539,6 ms |
| 5.000 | 181,1 / 838,9 ms | 400,0 / 645,8 ms | 150,9 / 169,5 ms | 567,2 / 587,1 ms |

Cada tamaño usó una búsqueda de calentamiento y diez medidas; 1.000 y 5.000 tuvieron tres series. Se comprobó el total exacto para término común (todos), medio (cada segundo), raro (cada centésimo) y cero. En el último control de ACL isolated count delta p50/p95 fue 0,34/3,68 ms (100), −0,03/0,76 ms (500), 1,51/7,39 ms (1.000) y 0,56/14,57 ms (5.000); la diferencia negativa de 500 ms está dentro del ruido de una resta de mediciones. El count y la consulta de página tienen perfiles separados; en la muestra común de 5.000, página p50 fue 146 ms en la primera serie y subió en las series posteriores, mientras el count p50 subió de 14 a 62 ms.

### Causa confirmada y mantenimiento

El plan previo a mantenimiento de estadísticas tenía `CorpusDocument` como relación externa, estimaba 1 fila frente a 600 reales y ejecutaba un nested loop contra `WorkspaceDocument`: 600 loops, 292 filas internas por loop y 174.750 filas descartadas por el predicado de unión `CorpusDocument.id = WorkspaceDocument.documentId`. La búsqueda interna usaba el índice único `(workspaceId, documentId)`, pero sólo acotaba `workspaceId`; `documentId` se evaluaba como filtro de unión. Un Hash Join posterior recorrió el set de relaciones una vez y eliminó esas descartadas. El coste dejó de crecer como candidatos × relaciones del workspace.

La migración aditiva `20261013150000_sprint1511_private_search_stats_maintenance` configura auto-ANALYZE local en `CorpusDocument` (threshold 50, scale factor 0,005) y `WorkspaceDocument` (threshold 50, scale factor 0,02), y ejecuta `ANALYZE` inicial en ambas. El dump previo DEV mide 570.040.509 bytes; SHA-256 `16c7bdf3712df3d95625bb00604ba716f71c2a9aa622ba42a0fc7b22995e30c9`. `autovacuum=on`, `n_mod_since_analyze=0` al cierre. Se conservaron índices existentes; no se agregó ninguno. El índice `(workspaceId, documentId)` ya existía. El planner puede elegir Seq Scan para el pequeño set de relaciones y Hash Join según cardinalidad; no se forzó un índice por hints.

La ACL aislada después se resuelve como join por conjunto. Membership del usuario se comprueba una vez por request en el servicio; cada consulta de página/count mantiene el scope privado dentro de SQL, y la consulta de página recibe candidatos del CTE autorizado por workspace. Se probaron `EXISTS`, JOIN, IN y CTE materializado; con estadísticas frescas todos se redujeron a planes hash equivalentes, así que no se retuvo una reescritura distinta.

### Límite restante

El EXPLAIN reproducible de candidatos privados a 5.000 muestra que `CorpusSearchToken_token_trgm_idx` entrega 113.800 entradas para 5.000 IDs únicos. Sigue `Unique`/`Gather Merge`, con 10.000 búsquedas por PK de `CorpusDocument`; la ACL ya aparece como Hash Join y no elimina filas. El candidate page simplificado ejecutó en 142 ms, pero la latencia medida de consulta de página alcanzó 747 ms p50 de la tercera serie y la request tuvo p95 839 ms. El count exacto de cero resultados examina el GIN de `CorpusDocument.searchText` y la request se mantiene entre 500–590 ms incluso con sólo 100 documentos privados. El trabajo residual es reducir candidatos trigram falsos/duplicados y medir la consulta completa page/hydration; no ampliar todavía los espacios.

La carpeta con 2.500 de 5.000 documentos devolvió 2.500 exactos; búsqueda total devolvió 5.000. Páginas 1, 125 y 250 devolvieron 20 filas cada una, 60 IDs únicos y cero faltantes. Olas sintéticas de 1/5/10 requests terminaron sin errores ni timeouts (163,1 / 213,9 / 188,9 ms de tiempo agregado). A/B cruzado, conteos, metadata, viewer, descarga, membership, espacio desactivado y exclusión de admin global se mantienen PASS. Search general verify PASS (17.078 documentos / 18.799.500 tokens, stale 0, discrepancias 0/100), paridad 40/40, viewer 6/6. TERM general p50/p95 216/322 ms frente al run comparable Sprint 14.9.2 de 201/279 ms; +7,7%/+15,3%. PHRASE sólo smoke/perfil comparativo: 1.711/2.621 ms, sin cambios al motor; deuda de total exacto permanece.

Artefactos no versionados: `_recovery-work/sprint1511/` (`baseline.json`, datasets, benchmark privado antes/después, ACL count, query shapes, audit de índices, planes de ejecución, variación, general Search, paginación/carpeta, concurrencia, verificación de corpus, paridad, backup y resumen final). No se usaron datos reales de juzgados ni se accedió a producción/preproducción. Esta evidencia técnica no constituye UAT humano.

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
## Sprint 15.3 — Copernic Classic UX 2.0 (2026-10-13)

**PARTIAL.** /spaces ofrece búsqueda privada desktop-first en tres paneles. El lateral muestra sólo los espacios autorizados, carpetas Galilei y fuentes; las subcarpetas de SourceFile.relativePath se derivan en memoria y no crean WorkspaceFolder. Carga manual se presenta una sola vez como fuente virtual. El alcance visible cambia entre espacio, carpeta, fuente y carpeta de fuente; Search por contenido y nombre aplica los mismos filtros autorizados.

El centro conserva la búsqueda explícita con ayuda de sintaxis. No hay búsqueda por tecla ni filtros de fecha/tipo activos porque la API privada no los soporta; tampoco se ofrece un filtro de extensión que no corresponda al pipeline actual, que indexa PDF. Las filas son compactas y muestran nombre, página, fragmento resaltado, carpeta/fuente y fecha. El conteo distingue respuestas parciales: si totalExact=false, la interfaz muestra “Más de N”.

El panel derecho reutiliza CorpusPdfViewer y carga sólo el documento seleccionado desde metadata, /matches y /file protegidos. La selección no cambia de ruta; Escape la limpia. El visor completo abre en página y coincidencia actuales. La vuelta al Search conserva workspaceId, query, fuente/carpeta, página, selección y match. Ctrl+F enfoca la consulta; flechas mueven selección cuando la lista tiene foco; Enter muestra el preview; F3/Shift+F3 avanzan/retroceden coincidencias. Los requests previos de Search y preview se cancelan al cambiar el contexto.

El resaltado TERM del fixture y el salto a página pasan en browser. El alineamiento exacto entre offsets del extractor y text layer de PDF.js, en particular para PHRASE, todavía no está garantizado; la UI no afirma spans de frase exactos. PHRASE conserva el contrato de total parcial y su deuda de rendimiento, sin cambio al parser ni al ranking.

### Verificación Sprint 15.3

Playwright DEV sintético: 2/2 escenarios PASS; Search privado, filtro __manual_upload__, preview persistente, PDF en página 2, controles de página, ArrowDown/Enter, Escape, F3/Shift+F3, regreso con estado, Viewer y descarga; denegación A/B produjo 404 sin render. Capturas inspeccionadas a 1366×768 y 1920×1080, sin overflow horizontal. Archivos locales ignorados: _recovery-work/sprint153/screenshots/.

La corrida final de browser midió Search request 155 ms, primer resultado 12 ms, primer render PDF 954 ms, cambio de página 61 ms y navegación F3 10 ms. Son mediciones de un fixture DEV y no SLO.

prisma migrate status: 24 migraciones, schema al día. Search verify: 17.078 documentos, 18.799.500 tokens, stale=0, 0/100 discrepancias; general smoke 21 resultados, 20 devueltos y 0 privados; Viewer general 6/6. Integración específica de fuentes: 1 suite / 1 test PASS. Typecheck y builds frontend/backend PASS; lint dirigido a archivos modificados PASS. El lint completo conserva cuatro errores previos en páginas institucionales ajenas a este cambio.

Sprint 15.3 queda PARTIAL por exactitud de spans PHRASE y refinamientos de tipo/fecha todavía no respaldados por API; no se presenta como aceptación humana. ACL y separación Search general/privado: PASS. No hubo acceso a preproducción, producción o shares institucionales.

## Sprint 15.3.1 — filtros privados y spans (2026-10-14)

Search privado conecta los controles de workspace, source, folder, PDF/TXT y rango de fechas con las rutas backend de contenido y nombre. Source, folder, tipo, fecha y query se combinan dentro de SQL después de validar la membership y antes del conteo/página. El count se calcula con los mismos predicados. Se conserva la denegación 404 al manipular un workspace/documento ajeno y la separación GENERAL/PRIVATE_WORKSPACE.

La fecha es `CorpusDocument.decisionDate` únicamente. Los parámetros `AAAA-MM-DD` son inclusivos; el día final usa el límite exclusivo del día siguiente sobre `TIMESTAMP(3)` sin zona. No hay fallback a `createdAt`, y los documentos sin fecha no entran en rangos. El tipo se deriva del MIME de la última versión: PDF (`application/pdf`) y TXT (`text/plain`); tipos desconocidos se excluyen cuando se filtra. La carga privada manual admite TXT como texto plano; fuentes de red siguen con el pipeline PDF vigente.

`/matches` devuelve rango original de página (`start` inclusivo, `end` exclusivo, UTF-16), texto coincidente, tipo TERM/PHRASE, ordinal global y ordinal local de ocurrencia, más contexto. La frase admite whitespace normalizado, incluso salto de línea, y mantiene un único span sobre el segmento original; puntuación y palabras intermedias impiden una coincidencia de frase. El PDF viewer mapea con contenido/contexto/ordinal y no marca cuando queda ambiguo. La prueba Playwright comprobó `JORGE PORCEL` exacto en el fixture y navegación/retorno; la alineación universal entre extracción PDF y PDF.js continúa PARTIAL.

La integración PostgreSQL de workspaces pasó con TXT sintético y filtros source/folder/type/date/combinado; el benchmark de filtro (10 muestras y 1 warmup, fixture de dos documentos) registró p50/p95 de 17,76/18,90 ms source; 17,13/20,34 folder; 18,84/24,59 type; 17,12/18,09 date; 20,87/22,62 combined. Playwright: 2/2 PASS, incluidos exact phrase highlight, tipo/fecha por request, F3/Shift+F3 y retorno con contexto. No se agregó schema/migración, OCR, NEAR ni formatos adicionales.

El benchmark general TERM y PHRASE de 2 palabras no muestra regresión material en p95; Search verify 17.078/18.799.500, stale 0, mismatch 0/100; Viewer general 6/6. El estado permanece **PARTIAL** por la cobertura limitada del mapeo PDF extractor↔PDF.js y no sustituye UAT humana, acceso UNC, preproducción o producción. Evidencia ignorada por Git: `_recovery-work/sprint1531/`.

## Sprint 15.4A — formatos y extracción documental (2026-10-14)

La carga privada acepta PDF/TXT/RTF/DOC/DOCX/ODT y las fuentes detectan esas extensiones, usando firma/estructura y MIME canónico. La UI informa máximo 20 archivos/20 MiB y aclara que DOC legado aún no se extrae. TXT/RTF/DOCX/ODT se extraen localmente; resultados de texto tienen preview genérico, match textual y descarga protegida del original. La matriz completa y los límites de seguridad están en `BJC-PROCESAMIENTO-DOCUMENTAL.md`. DOC se detecta pero se rechaza con `LEGACY_DOC_UNSUPPORTED`; no se convierte ni ejecuta Office.

PDF conserva texto nativo página por página. Páginas con menos de 25 caracteres extraídos se señalan como candidatas, pero esta PC no tiene motor/modelo OCR ni worker: no hubo OCR ni texto inventado. El documento puede quedar `OCR_REQUIRED` y el Search mantiene disponible su texto nativo. E2E autenticado terminó 2/2 con RTF, preview/marca F3 y descarga, filtros PDF/RTF, y escenarios de roles/workspace/denegación ACL; en la corrida final Search midió 140 ms, primer resultado 8 ms, preview PDF 1.012 ms, cambio de página 49 ms y F3 27 ms sobre fixtures DEV (no SLO).

Pruebas de extracción/seguridad 17/17, suite backend 112 PASS y 20 opt-in omitidas, Workspace PostgreSQL 1/1 y Source PostgreSQL 2/2; Prisma status 24/24; builds, typecheck y lint dirigido PASS. Search verify siguió 17.078 docs/18.799.500 tokens, stale 0 y mismatch 0/100 sin rebuild. Search general smoke 21 total/20 devueltos y 0 IDs privados; Viewer general 6/6. El estado 15.4A es **PARTIAL** por OCR y `.doc`; no habilita UAT institucional ni producción. Artefactos: `_recovery-work/sprint154a/`.
## OCR y DOC dentro de workspaces — Sprint 15.4A.1 (2026-10-14)

PDF escaneado cargado en un workspace puede quedar `OCR_PROCESSING` mientras el backend responde normalmente. El job referencia documento/archivo y SHA; reemplazar el archivo cancela o invalida el trabajo pendiente anterior. Al finalizar, sólo se actualiza la proyección del documento dentro del scope original. Las pruebas de integración ejercitaron Search privado, denegación desde otro workspace, Search general sin fuga y descarga protegida.

El procesamiento no concede acceso por sí mismo: toda lectura sigue requiriendo membresía activa y scope autorizado. DOC OLE se extrae localmente bajo las mismas ACL. El corpus sintético E2E se limpia al terminar; la verificación final no encontró workspaces ni documentos de prueba residuales.

## Sprint 15.6 — UX cero capacitación (2026-10-14)

Se humanizó la entrada y búsqueda: miembros con una dependencia entran directamente; miembros con varias ven «¿Dónde querés trabajar?» y eligen nombres humanos. Dependencia, carpetas, búsqueda, preview, procesamiento y destino/acceso de upload usan copy claro. El árbol ahora permite expandir/contraer, informa nivel/selección y tiene foco de teclado. Fuente administrativa se mantiene en la ruta de gestión; el usuario común sólo ve nombres de carpetas compartidas, nunca UNC.

**Límite de producto confirmado:** el backend sólo modela membership de dependencia y ubicación opcional en una carpeta. No hay documentos sólo del propietario ni ACL restringida por carpeta. Por eso no se muestran «Mis documentos — sólo vos» ni «Restringida — usuarios elegidos», y las cargas informan que quedan compartidas con miembros autorizados. El `RESTRICTED` interno de Corpus es aislamiento de `PRIVATE_WORKSPACE` frente al corpus GENERAL; no restringe el documento a un subconjunto de la dependencia. La especificación completa y el plan de autorización están en `BJC-UX-ESPACIOS-DOCUMENTALES.md`.

Dictamen Sprint 15.6: **PARTIAL** respecto de la misión completa; Playwright autenticado 2/2, matriz responsive 7/7 sin overflow y capturas clave inspeccionadas. Search golden 1/1, Source PostgreSQL 2/2, Search verify stale=0/mismatch=0/100/rebuild=0; Prisma 25 migraciones al día. La prueba Workspace PostgreSQL falló dos veces en el intento OCR (esperado 1, observado 2) mientras había un backend activo en 4001; la concurrencia externa es una hipótesis, no una causa confirmada. Baseline DEV restaurado y storage sintético eliminado. UAT humana, permisos personales/restringidos y preproducción pendientes. Sin cambios en Search core, Viewer core, OCR, backend, Prisma, esquema o migraciones.

## Sprint 15.6.1 — modelo y operación de permisos (2026-10-14)

El estado anterior documenta Sprint 15.6 y queda supersedido por esta ampliación aditiva. `WorkspaceDocument` y `WorkspaceFolder` ahora tienen dos ámbitos mutuamente excluyentes por restricción de base de datos: una fila de dependencia (`workspaceId`, `ownerUserId = NULL`) o una fila personal (`workspaceId = NULL`, `ownerUserId`). El servidor asigna el propietario desde la identidad autenticada; nunca acepta un propietario elegido por el cliente. Las carpetas personales son globales a la cuenta y no dependen de una sala/juzgado.

Las carpetas de dependencia usan `INHERIT`, `DEPENDENCY_SHARED` o `RESTRICTED`. `INHERIT` conserva el alcance explícito más cercano; las comprobaciones de lectura validan todos los ancestros, de modo que una subcarpeta no abre por accidente una ruta restringida. Para ampliar se cambia el alcance de la carpeta restringida superior con confirmación. `WorkspaceFolderGrant` apunta a `WorkspaceMembership`, no a un usuario arbitrario; sólo se aceptan membresías activas de la dependencia. Creador y rol ADMIN conservan acceso a carpetas restringidas. ADMIN/EDITOR pueden administrar alcance según las reglas del servicio.

Search, conteos, árbol, metadatos, `/matches`, Viewer y descarga aplican los mismos permisos efectivos. Las denegaciones de documentos ajenos responden 404. El grant se consulta en vivo, sin caché que prolongue una revocación. Una asociación lógica separada puede compartir el mismo `CorpusDocumentFile` y SHA; la autorización sigue siendo independiente por asociación. La búsqueda general continúa en su scope anterior.

Las migraciones `20261014130000_sprint1561_personal_restricted_acl` y `20261014140000_sprint1561_ocr_test_queue_isolation` son aditivas y se aplicaron sólo a PostgreSQL DEV guardado en `127.0.0.1:55432/buscador_juridico_civil_dev`. No hubo backfill de propietario ni cambio deliberado de permisos existentes; las carpetas preexistentes reciben el valor compartido predeterminado y los documentos de dependencia siguen con su asociación previa. El backup verificado, checksums, matriz ACL y evidencias viven en `_recovery-work/sprint1561/` (local ignorado por Git).

Los documentos sincronizados desde una fuente de red permanecen gestionados por esa fuente y no pueden hacerse personales ni compartirse por el endpoint de documentos personales. El cleanup final removió todos los datos de aceptación sintéticos y los cuatro blobs de storage aislado; la proyección Search quedó en 17.078 documentos, 18.799.500 tokens, cero stale, cero discrepancias de muestra y cero rebuilds. Cierre técnico DEV: **PASS**. UAT humana, acceso UNC aprobado y gates de preproducción/producción continúan pendientes.
