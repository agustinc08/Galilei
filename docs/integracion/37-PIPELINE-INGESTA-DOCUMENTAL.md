# 37 — Pipeline de ingesta documental

## Flujo

`DocumentSourceAdapter.discover()` → SHA-256 → clave de idempotencia → `CorpusDocument` / `CorpusDocumentFile` → `DocumentStorageAdapter.put()` → `CorpusIngestionRecord` → `DocumentTextExtractor` → extracción/páginas → proyección `CorpusDocument.searchText` → `CorpusSearchSourceAdapter`.

El pipeline es secuencial y manual en esta fase; no hay watcher, scheduler ni conector de red. Existen adaptadores `ManualFixtureSourceAdapter` y `LocalFolderDocumentSourceAdapter`. El scan local es explícito, recursivo, sólo PDF/TXT, ignora symlinks y registra path relativo como procedencia; el path de carpetas no se convierte en tema jurídico. CIJ/CSJN quedan como conectores futuros, sin scraping.

## Idempotencia y deduplicación

La clave persistida es SHA-256 de `sourceSystemId + event identity + file checksum`; event identity prioriza `externalId`, luego path relativo y finalmente nombre. Repetir exactamente el evento no crea documento, archivo, extracción ni evento adicional. Un external ID ya visto con checksum nuevo conserva el documento y agrega archivo versionado. El binario local se guarda por SHA-256 y extensión normalizada; duplicados entre documentos distintos conservan registros/procedencia separados y reutilizan el objeto físico.

## Estados, errores y retry

El evento/documento transita por `DISCOVERED`, `STORED`, `INDEXED`, `OCR_REQUIRED` o `FAILED`/`EXTRACTION_FAILED`. Un fallo de extracción conserva fuente, documento y archivo, registrando etapa, mensaje, fecha y retryable. `retryExtraction(documentId)` vuelve a leer el archivo almacenado, crea una nueva extracción y reconstruye la proyección sin borrar el documento. No hay reintento automático de red ni scheduler.

## Storage

`DocumentStorageAdapter` es reemplazable; `LocalDocumentStorageAdapter` escribe de modo content-addressed, valida SHA-256 al reutilizar y sólo acepta keys con formato hash/extensión, sin `..` ni rutas absolutas. Base path configurable con `BJC_CORPUS_STORAGE_PATH`; default DEV desde la raíz del workspace: `_dev-corpus-storage`. No se copiaron documentos institucionales.
