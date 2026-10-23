# 40 — Resultado Misión 6: Corpus Documental Civil

**Fecha:** 2026-10-07. **Dictamen:** CORPUS DOCUMENTAL — GO CON AJUSTES, sólo para infraestructura y datos sintéticos en DEV.

## Demostración end-to-end

- PostgreSQL DEV guard confirmó `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`; PostgreSQL 16.15, `pg_trgm 1.6`; schema verify PASS con 10 migraciones/29 tablas.
- Se añadieron seis fixtures sintéticos: PDF con texto en dos páginas, copia exacta con otro nombre, PDF sin capa de texto, dos `mismo-nombre.pdf` de bytes distintos y TXT. Ningún archivo institucional o confidencial fue copiado.
- Tres pruebas PostgreSQL Corpus PASS: ingesta y búsqueda con snippet/source/checksum/file ID/página 2; repetición idempotente; SHA compartido no fusiona documentos; mismo nombre con SHA distinto; ACL restricted no filtra conteo; `OCR_REQUIRED`; TXT y retry tras fallo sin borrar documento; vínculo a referencias sintéticas de Jurisprudencia y Digesto.
- Siete pruebas PostgreSQL Search existentes PASS; suite general: 41 PASS, 10 omitidas (PostgreSQL opt-in, verificado aparte); `pnpm build` y `tsc --noEmit` PASS.
- Search smoke read-only `numeroSentencia:1113`: tres muestras, p50 1.72 ms, p95 1.99 ms. No se modificó benchmark ni se repitió la campaña de performance de Fase 5.

## Implementado

Schema aditivo `CorpusSourceSystem`, `CorpusIngestionRecord`, `CorpusDocument`, `CorpusDocumentFile`, `CorpusExtraction`, `CorpusDocumentPage`, `CorpusDocumentLink`; almacenamiento local content-addressed con verificación de SHA; source adapters Manual/Fixture y scan explícito de carpeta local; extractor PDF/TXT; retry; búsqueda que satisface el contrato Search compartido; ACL por visibilidad previa a total/filas; proyección indexada con GIN trigram parcial.

## Ajustes antes de la fase de conectores/usuarios

No se implementó OCR, DOCX, scraper CIJ/CSJN, watcher, UI, endpoint de lectura/descarga autenticado, matriz ACL institucional ni fan-out del endpoint de búsqueda existente. Corpus no contiene datos reales; la búsqueda sólo demuestra flujo y fixture en DEV. Definir ACL/SLO y probar volumen real antes de producción. El adaptador de folder scan todavía no importa carpetas institucionales.

## Siguiente fase

Fase 7 — CIJ histórico Civil, precedida por la definición/autorización del mecanismo de acceso. No iniciar scraping masivo como parte de Misión 6.
