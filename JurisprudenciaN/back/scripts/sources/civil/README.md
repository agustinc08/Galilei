# Adquisición de jurisprudencia civil — herramientas

- `historical-backfill.cjs`: recorre el formulario histórico público sin filtros, 20 resultados por página; guarda metadata y checkpoint SQLite en `_recovery-work/sprint142/historical.sqlite`. Reanuda al volver a ejecutar `pnpm civil:backfill`.
- `filtered-civil-backfill.cjs`: consulta el filtro estructurado histórico `tid=18` y persiste su checkpoint separado en `civil_filter_pages` dentro del mismo manifest.
- `download-pilot.cjs`: descarga el flujo normal del botón para una muestra balanceada por año. Hace POST `acc=showFile&flid=…`, sigue una única redirección observada a `/adj/fallos/`, valida status, tipo PDF, firma, SHA-256 y rename atómico. 403/429 detienen ese documento sin evasión.
- `prepare-corpus-package.cjs`: empaqueta los PDFs verificados por SHA con metadata/IDs relacionados para import idempotente.
- `verify-pilot.ts`: consulta DEV bajo guard y prueba extracción, búsqueda, página, matches y acceso al archivo.
- `current-sync-preflight.cjs`: verifica robots y el formulario actual; informa el bloqueo si se requiere token humano.

Los PDFs validados quedan en `_recovery-work/sprint142/pilot/`, pendientes de reconciliación por hash y metadata antes de ingesta. Ninguna operación de DB de producto se ejecuta desde estos scripts.
