# Fuentes documentales privadas

> **Contexto INT-1 (2026-10-14):** Este contrato forma parte de Galilei integrado en la rama de integración. La interfaz presenta Jurisprudencia, Mi Sala / Juzgado y Mis documentos; Copernic queda como nombre interno. El estado global es PARTIAL y no habilita actualizar origin/dev: el snapshot local de publicación no coincide con el certificado y faltan los manifiestos J7/J8. Ver BJC-ESTADO-ACTUAL.md; los cortes y resultados históricos debajo conservan la fecha/sprint que los generó.


## Estado

Sprint 15.2 agrega en DEV fuentes de carpetas de red para los workspaces privados. La validación con carpetas sintéticas pasó; no se probó una UNC institucional real ni hubo UAT con personal de dependencias. El benchmark legacy de paridad 40/40 no pudo correr porque falta su base SQLite local. Search general, proyección y Viewer se verificaron por separado. Estado del sprint: **PARTIAL por verificación ambiental**.

## Modelo y límites

La migración aditiva `20261013170000_sprint152_document_sources` agrega `DocumentSource`, `SourceFile` y `SourceScanRun`, junto con estados e índices. No reescribe el Corpus existente ni reproyecta Search. Se aplicó sólo a `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`, después de crear y verificar dump y SQL pre-migración. Los checksums constan en `_recovery-work/sprint152/backups/manifest-before-migration.json`; esa carpeta permanece ignorada por Git.

`DocumentSource` pertenece a un workspace y representa una carpeta UNC. `SourceFile` guarda ruta relativa normalizada, metadata, SHA-256, estado y vínculo lógico a `CorpusDocument`. `SourceScanRun` guarda estado/counters y un lock único por fuente para impedir escaneos simultáneos. El backend enumera y lee PDFs usando su identidad Windows/SMB; no se guardan usuarios ni passwords SMB. IT debe conceder lectura SMB y NTFS a esa identidad.

Sólo se indexan PDFs de hasta 20 MiB, mediante el pipeline PDF existente. No se siguen enlaces/reparse points ni rutas fuera de la raíz; la lectura vuelve a comparar tamaño, mtime y SHA para detectar cambios concurrentes. Se conserva el nombre de archivo como metadata segura. El path UNC completo sólo se presenta en endpoints de administración del workspace.

## Contrato de escaneo

- El ADMIN inicia el escaneo; la API devuelve un run `QUEUED` y el trabajo sigue en segundo plano dentro del proceso backend. Hay como máximo un run activo por fuente.
- `NEW`: se indexa un documento nuevo. `MODIFIED`: se actualiza la versión del mismo documento lógico. `UNCHANGED`: no requiere nueva ingesta. Si tamaño/mtime cambiaron, se calcula SHA; mismo contenido se registra como cambio sólo de metadata.
- Un renombre se reconcilia sólo cuando hay una pareja inequívoca de ruta nueva y desaparecida con el mismo SHA; conserva el vínculo lógico y no cuenta como faltante.
- Un archivo no PDF queda `UNSUPPORTED`; errores por archivo quedan registrados y hacen el run `PARTIAL`. Una caída/inaccesibilidad o enumeración incompleta evita reconciliar ausencias.
- `MISSING` es un estado de la fila de origen. No borra `CorpusDocument`, `WorkspaceDocument` ni el blob. Un share offline conserva los documentos existentes.
- Al reiniciar el backend, runs `QUEUED/RUNNING` antiguos se cierran como fallidos y liberan el lock; se puede iniciar otro escaneo.

Estados de fuente: `UNKNOWN`, `CONNECTED`, `OFFLINE`, `ACCESS_DENIED`, `ERROR`. Estados terminales del run: `COMPLETED`, `PARTIAL`, `FAILED`.

## Acceso, rutas y Search

Todas las operaciones de fuentes requieren membership activa `ADMIN` en el workspace concreto. El rol global ADMIN por sí solo no habilita acceso; workspace desconocido o ajeno responde 404. La política se verifica en `DocumentSourceService` además del rol autenticado del controller.

- `POST /api/workspaces/:workspaceId/sources/test-access`
- `GET/POST /api/workspaces/:workspaceId/sources`
- `GET/PATCH /api/workspaces/:workspaceId/sources/:sourceId`
- `POST /api/workspaces/:workspaceId/sources/:sourceId/scan`
- `GET /api/workspaces/:workspaceId/sources/:sourceId/runs`
- `GET /api/workspaces/:workspaceId/sources/:sourceId/files?page=N`

La Search privada conserva el filtro SQL exacto por workspace antes de conteo, página y snippet. Sus resultados pueden mostrar el alias de origen, nunca su path UNC. Search general sigue limitado a `documentScope=GENERAL`; no expone documentos privados aunque el usuario sea ADMIN global. Aún no hay filtro de Search por fuente.

## Verificación DEV

- Backup pre-migración: dump 570.098.541 bytes, SHA-256 `eb206897e71274a35422875a0f14dffc5ee4865137a7321ff173700520d4ba9d`; SQL 2.292.812.528 bytes, SHA-256 `37b725680fba62cc65ae204ccf21a86c1ba6a6bd27392632fdaad9a20090f5d9`. `pg_restore --list` y verificaciones SHA pasaron.
- `prisma migrate status`: 24 migraciones, schema al día. `schema-verify`: 52 tablas; proyección lista con 17.078 documentos y 18.799.500 tokens.
- Integración de fuentes PASS con PDFs temporales: alta, sin cambios, mtime-only, altas/modificados/ausentes, renombre, SHA compartido entre workspaces, share offline, Search privado, Viewer por hash y aislamiento ACL. UNC institucional: no probada.
- Benchmark sintético de reconciliación: 100/1.000/5.000 archivos sin cambios, cero hashes y cero reingestas; total 29,87/242,59/1.190,1 ms. Son fixtures metadata locales, no una medida SMB ni de ingesta PDF real.
- Search general “responsabilidad”: 21 resultados, 20 devueltos, cero IDs privados. Search verify PASS y Viewer general PASS 6/6.
- Typecheck/lint y builds backend/frontend PASS. Suite backend completa: 94 PASS, 19 omitidas, 0 fallos (21 suites PASS, 7 omitidas).
- Paridad legacy 40/40: bloqueada porque falta `_legacy-audit-work/extracted/jurisprudencia/jurisp_6/db/jurisprudencia_db.sqlite` en esta PC. No se reporta como PASS.

La evidencia detallada vive en `_recovery-work/sprint152/` y permanece local/ignorada. No se usaron shares, documentos institucionales, producción ni preproducción.
## Refinamiento de búsqueda por fuente — Sprint 15.3 (2026-10-13)

La UI Copernic expone sourceId y sourceFolder como alcance opcional de Search privado y búsqueda por nombre. El pseudo-source __manual_upload__ limita resultados a documentos cargados manualmente, excluyendo documentos vinculados a una fuente documental del mismo workspace. Las fuentes reales validan membership y pertenencia al workspace antes de enumerar carpetas o buscar; sus rutas UNC completas no se devuelven a Search.

GET /api/workspaces/:workspaceId/search/sources devuelve alias, estado y cantidad autorizados. GET /api/workspaces/:workspaceId/search/sources/:sourceId/folders deriva el árbol virtual de relativePath (máximo 5.000 carpetas); no crea carpetas persistidas ni devuelve los paths raíz. La integración sintética verificó filtro por fuente/carpeta en contenido, nombres y denegación de fuente de otro workspace. El SQL conserva workspace/ACL como límite obligatorio.

## Sprint 15.4A — formatos reconocidos

El scanner incluye `.pdf`, `.txt`, `.rtf`, `.doc`, `.docx` y `.odt` con límite de 20 MiB. La detección valida el contenido y establece MIME canónico; `.doc` legado se registra explícitamente como no soportado por falta de extractor seguro. PDF escaneado no recibe OCR en esta versión; `OCR_REQUIRED` preserva cualquier texto nativo disponible. Integración PostgreSQL DEV probó RTF/DOCX/ODT, hash/no-change scan, filtros Search, archivos originales y aislamiento ACL. No se alteraron paths UNC, ni se probó una share institucional. Límites/provenance: `BJC-PROCESAMIENTO-DOCUMENTAL.md`.

Search general no cambió y mantiene documentScope=GENERAL. Detalle UX, resultados y límites en BJC-ESPACIOS-DOCUMENTALES.md, Sprint 15.3. No se probó una UNC institucional.
## OCR incremental en sincronización — Sprint 15.4A.1 (2026-10-14)

La sincronización de una fuente puede encolar OCR cuando el SHA del archivo no cambia y la extracción indica páginas candidatas, el job existente se reutiliza: no repite OCR ni reindexado. Un cambio de SHA invalida la extracción anterior y genera trabajo nuevo; un rename inequívoco conserva el contenido y no dispara OCR. Los jobs y provenance son locales y la fuente/original permanece read-only.

El worker no escanea roots en segundo plano ni realiza fetch externo desde documentos. Su cola está limitada, procesa un trabajo a la vez por instancia y usa retries/leases persistentes. Las pruebas de fuente usan fixtures sintéticos/locales; no habilitan acceso a una UNC ni aceptación de una dependencia real.

## UX de fuentes para Sprint 15.6

La administración de carpetas de red, estado de sincronización y diagnóstico queda bajo permisos de gestión; no se incorpora al panel normal de búsqueda. En la navegación se presenta el nombre configurado de la carpeta y las subcarpetas relativas, nunca la ruta UNC como título. Si el origen no está disponible, el usuario ve un mensaje general y los resultados ya incorporados conservan su disponibilidad autorizada.

Las fuentes actuales siguen compartidas dentro de la dependencia mediante membresía. La interfaz no permite tratar una fuente o carpeta como personal o restringida a usuarios seleccionados; esos permisos no existen aún en el backend.

## Sprint 15.6.1 — límites de acceso de archivos sincronizados (2026-10-14)

Las fuentes conservan la propiedad operativa de sus archivos sincronizados. El endpoint para mover un documento personal a una dependencia y el de una dependencia a Mis documentos rechazan un documento vinculado a `SourceFile`; el usuario no puede privatizar ni republicar arbitrariamente un archivo de red. Sus permisos siguen los de la dependencia y la carpeta correspondiente. El contrato de ACL, la regresión que comprueba este rechazo y el dictamen técnico están en `_recovery-work/sprint1561/` y `BJC-ESPACIOS-DOCUMENTALES.md`.

Esta protección se probó con una fila `DocumentSource`/`SourceFile` sintética en DEV. No se probó un share UNC institucional real ni se modificaron configuraciones, credenciales o archivos de ninguna fuente existente. UAT de la identidad Windows y autorización institucional permanecen pendientes.
