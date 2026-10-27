# Sprint 8 — OCR con revisión humana: arquitectura

## Estado y límites

Este documento define el flujo incorporado por Sprint 8 sobre la base exacta de Sprint 7 (`f631eb9dc76c450fd0656ce5d6f341e4c711e116`). La cola toma únicamente documentos institucionales internos del Corpus que requieren OCR. No hace backfill del Corpus ni accede a DEV, main, Sytec10, servicios principales o entornos de oficina.

El PDF almacenado en `CorpusDocumentFile` es el original inmutable. Se verifica su SHA-256 antes de procesarlo y al servirlo. OCR local produce una versión candidata separada. Ningún worker automático publica texto de revisión ni cambia Search.

## Fuentes de verdad

- El binario original, su identidad SHA-256 y su almacenamiento siguen en `CorpusDocumentFile`.
- El motor local existente (`LocalPdfOcrProcessor`) genera texto candidato por página y registra motor, versiones, configuración, huella de ejecución y checksum del origen.
- Los modelos de revisión Sprint 8 conservan ejecuciones OCR, páginas, correcciones explícitas, estados y revisiones append-only.
- `CorpusExtraction` y `CorpusDocumentPage` siguen siendo la representación canónica de texto aprobado que consume el viewer y Search.
- La aprobación final crea una extracción nueva y actualiza `CorpusDocument.searchText` y `latestExtractionId` en una transacción. Los triggers existentes escriben el `SearchIndexOutbox`; la proyección OpenSearch se actualiza por el worker ya existente.
- Reabrir una página no modifica ni retira la extracción ya aprobada. La versión aprobada previa permanece activa hasta una nueva aprobación completa.

## Flujo

1. La cola pagina y filtra documentos `OCR_REQUIRED` elegibles; sus contadores se calculan en servidor.
2. Al abrir el caso se verifica acceso al recurso y se obtiene el PDF a través del mismo almacenamiento e integridad que el visor Corpus.
3. La revisión se identifica por documento y archivo. El SHA del archivo permite reutilizar una ejecución OCR válida para binarios idénticos sin compartir correcciones o aprobaciones entre identidades jurídicas distintas.
4. OCR se ejecuta únicamente mediante herramientas locales aprobadas. Cada página conserva el OCR original y un campo independiente para corrección humana.
5. Guardar requiere la versión observada de la página. Una escritura obsoleta responde conflicto y no sobrescribe cambios concurrentes. Guardados y transiciones generan una revisión con actor, hora y checksums.
6. Una página solo se aprueba mediante acción explícita; se puede marcar explícitamente “sin texto”. Rechazar y reabrir requieren actor autorizado y dejan historial.
7. La aprobación del documento se permite solo cuando cada página física está aprobada o marcada “sin texto”. Un único acto transaccional genera las páginas canónicas, la extracción, el texto Search y el evento/outbox existente. No altera publicación, metadatos legales ni verificación de citas.

## Acceso y exposición

Las mutaciones se protegen por rol y por recurso en el servicio. `LECTOR` no revisa ni aprueba. El PDF y los datos temporales solo se entregan después de comprobar pertenencia a la cola permitida, alcance general, visibilidad interna y relación exacta con el documento. La API pública solo consulta la extracción canónica; antes de aprobación continúa viendo el texto previo. Correcciones pendientes, OCR candidato y revisiones no se exponen a búsqueda pública.

La interfaz usa la ruta administrativa `/admin/jurisprudencia/ocr` (el router del cliente elimina el prefijo de grupo `(admin)` y mantiene el segmento `admin/`). El visor PDF.js existente muestra el original junto al OCR y al texto corregido, con navegación por número y páginas pendientes. En pantallas estrechas las columnas se apilan.

## Invariantes de concurrencia e idempotencia

- La clave de una revisión separa identidad de documento de identidad binaria.
- La ejecución OCR se conserva como evidencia; una reejecución no sobrescribe la anterior.
- Cada transición de página exige la versión esperada y usa actualización condicional dentro de una transacción.
- Finalizar verifica nuevamente en la transacción cantidad y estado de páginas; la segunda aprobación concurrente no crea una segunda versión canónica por accidente.
- La operación de aprobación es idempotente para el mismo estado y versión.
- La cola no se crea por un barrido de producción: solo lee el estado existente de ingestas institucionales y el bootstrap QA usa fixtures sintéticos.

## Search y fallos

La escritura canónica y el outbox relacional forman una única transacción. Si OpenSearch no está disponible, el texto aprobado permanece en PostgreSQL y el evento queda pendiente para reintento. La UI informa aprobación relacional separada de sincronización de Search. El motor no recibe textos de páginas en revisión y la publicación judicial no participa en este flujo.

## Migraciones y compatibilidad

La migración Sprint 8 es aditiva y no reescribe tablas históricas. El historial parte de 38 migraciones de Sprint 7 y termina en la migración 39. Se certifica la cadena desde esquema vacío y desde los puntos históricos 37 y 38; la ruta 37 aplica secuencialmente las migraciones de Sprint 7 y Sprint 8. La certificación se ejecuta solamente contra bases QA aisladas y con el guard de base de datos del proyecto.

## Riesgos que requieren certificación

La equivalencia real de los motores locales de OCR depende de la versión instalada de Tesseract y Poppler; la procedencia registra esas versiones. El estado `PENDING` de Search es posible durante una interrupción de OpenSearch y no implica que el documento haya sido publicado. La aprobación humana y el UAT institucional deben comprobarse en el entorno QA aislado antes de cualquier decisión operativa.
