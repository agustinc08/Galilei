# 52 — Resultado Misión 7.1 — Canal institucional de ingesta

**Fecha:** 2026-10-07 · **Dictamen:** IMPLEMENTADO Y VALIDADO EN DEV SINTÉTICO; **READY CON AJUSTES** para piloto institucional. No es GO de ingesta pública ni de producción.

## Entregado

- Contrato de paquete 1.0, validación de manifiesto JSON/CSV, scan/draft de carpeta, hash SHA-256, guardas de ruta/tipo/tamaño, avisos de duplicados.
- CLI `draft`, `validate`, `dry-run`, `import`, `status` y retry selectivo. Import idempotente y versionado reutilizando `CorpusIngestionService`; recibo JSON, checksum y Markdown por ejecución.
- Search federado aditivo al endpoint actual; Jurisprudencia+Corpus en paralelo, selección de fuente, timeout/aislamiento de fallos, orden/página estables y dedupe por links explícitos.
- Controlador Corpus, metadata/archivo con ACL, rutas públicas sólo PUBLIC y autenticadas para roles internos; PDF/TXT, filename seguro, no exponer storage key/path, byte Range.
- Pruebas unitarias del validador/CSV/path, fanout/ACL/Range, e integración PostgreSQL DEV de importación, receipt, búsqueda, acceso, ACL, idempotencia y versionado.

## Verificación

Guard DEV confirmó target `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`. Prisma generate PASS (7.8.0), `tsc --noEmit` PASS, build Nest PASS; adapter PostgreSQL Jurisprudencia 7/7, `corpus-tests` 3/3 y `corpus-package-tests` 2/2 E2E. Suite general PASS: 9 suites, 53 tests passed; 3 suites/12 pruebas opt-in omitidas (65 total). El test exhaustivo de SQLite requiere hasta 120 s; en esta ejecución completa corrió en suite de 59.887 s.

La importación sintética produjo 4 documentos, el segundo run reutilizó los 4; PDF sin capa resultó `OCR_REQUIRED`; dos contenidos iguales se almacenaron una vez por checksum; actualización del ID externo conservó versiones 1 y 2. Los recibos quedan particionados por packageId/runId; el destino se valida antes de escrituras DB.

## Ajustes y fuera de alcance

ZIP no se parsea ni se extrae directamente; entregar carpeta canónica luego de extracción segura. No existe tabla persistente de lote: receipt e identidad de paquete quedan en filesystem/metadata original. No se implementó firma de emisor, virus scan, OCR, reconciliación de revocaciones, watcher, ni clasificación/anonymización institucional. Tests usan datos sintéticos; no se recibió ni importó material real, ni se contactó CIJ/CSJN. M7 public scraping sigue NO GO por robots.

## Gate

El producto está habilitado para ensayo técnico DEV con paquetes controlados; antes de piloto real: autorización institucional explícita, muestra aprobada, matriz ACL/anonimización, validación de hashes/conteos por responsable y acuerdo de SLO. Antes de producción: carga concurrente, retención/backup de recibos y storage, seguridad de archivos y aprobación funcional.
