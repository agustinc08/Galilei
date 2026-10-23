# 51 — Seguridad, procedencia y límites del canal

## Controles implementados

- Validación de manifest versionado, ruta relativa/contención, rechazo de symlink, MIME y firmas PDF, tamaño por archivo y SHA-256 recalculado.
- SQL parametrizado y adapters limitados a PostgreSQL DEV exacto en el contexto local; guard revisa rol/host/puerto/base antes de pruebas/escrituras.
- Visibilidad por rol aplicada antes de búsqueda/total/metadata/archivo; 404 para ocultar existencia; filename sanitizado y storage fuera de rutas públicas.
- Receipt JSON separado del paquete, SHA verificable, resumen legible, historial por run y procedencia en metadata original.

## Límites residuales

La procedencia del emisor no está firmada ni autenticada criptográficamente; checksum prueba integridad del archivo recibido, no autoría ni legalidad. Los recibos están en filesystem, no hay tabla de batch ni firma digital de receipt. El sistema actual soporta PDF/TXT, no ZIP directo, OCR, virus scanning, PDF activo, cifrado de paquetes, límites globales de paquete, cancelación/resume por cursor, reconciliación de borrados/revocaciones ni vigilancia de carpetas. Un `sourceUrl` declarado no se descarga.

La ruta pública de archivo es accesible anónimamente sólo si el documento se clasificó PUBLIC. Esa clasificación necesita gobernanza antes de cualquier dato real. Los documentos institucionales no se ingirieron y la restricción de robots de CSJN/CIJ sigue vigente; un paquete autorizado es un canal separado y no una vía para sortear restricciones públicas.
