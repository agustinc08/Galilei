# 157 — Sincronización incremental — Sprint 14

No quedó habilitado un sync: el catálogo de tomos es paginado; la búsqueda por sentencia presenta reCAPTCHA; CIJ/TFN y API/history están restringidos. Ninguna fuente ofreció un cursor incremental verificable. No se programó una tarea del sistema.

El núcleo offline conserva transiciones seguras para futuras corridas: external ID nuevo → `NEW_DOCUMENT`; mismo ID y SHA distinta → `SOURCE_DOCUMENT_CHANGED` con ambas versiones; metadata modificada → `SOURCE_METADATA_CHANGED`; fuente remota ausente → `SOURCE_MISSING_RETAIN_LOCAL`; sin cambios → `UNCHANGED`. No elimina documentos locales. Una implementación debe guardar última corrida, cursor exitoso, fecha/ID más nuevos, ventana de solapamiento y checkpoint de páginas, y respetar rate limits/robots en cada inicio.

Estado `BLOCKED` para backfill y sync automático hasta contar con canal permitido, sin CAPTCHA y con cursor/export oficial.
