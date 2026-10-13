# 49 — Search federado y ACL documental

## Composición

El endpoint de búsqueda agrega el campo `federated` manteniendo la respuesta legacy para compatibilidad. `FederatedSearchService` consulta en paralelo los adapters PostgreSQL Jurisprudencia y Corpus; una fuente puede fallar o exceder 5 s sin invalidar resultados de la otra. Acepta filtros de fuente, pagina de forma estable por score/fecha/ID y limita overfetch a 500 resultados.

Los documentos Corpus enlazados explícitamente a IDs de Jurisprudencia se deduplican cuando el ID vinculado aparece en el prefijo recuperado. Si el prefijo puede ocultar duplicados fuera de él, `totalExact=false`; no afirmar un total exacto en ese caso. Filtros estructurados en Corpus incluyen sala, fecha, expediente, número, carátula, tribunal, tipo e instancia. No se consulta Corpus para resultados cuando se selecciona sólo Jurisprudencia, y viceversa.

## ACL antes de exponer

El adapter filtra `visibility` en el WHERE antes de conteo y página: PUBLIC ve PUBLIC; INTERNAL ve PUBLIC e INTERNAL; ADMIN ve las tres clases. La capa de acceso devuelve 404 ante documento invisible para no revelar existencia. No se incluye storage path en Search ni metadata.

Rutas autenticadas: `GET /api/corpus/documents/:id` y `GET /api/corpus/documents/:id/file` (ADMIN/OPERADOR). Rutas públicas: `GET /api/public/corpus/documents/:id` y `.../:id/file`, sólo para PUBLIC. Metadata expone procedencia, hashes, metadatos, páginas y URL segura; nunca ruta del filesystem. Descarga permite PDF/TXT, nombre sanitizado, inline PDF predeterminado, modo `download`, `nosniff`, `no-store` y un solo byte range; rango inválido responde 416.

La política de rol/visibilidad está implementada; no reemplaza una matriz institucional revisada, clasificación de datos personales, anonimización ni aprobación editorial. La consulta pública Search y su fan-out tampoco constituyen aprobación para publicar contenido recibido.
