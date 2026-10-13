# Scan incremental institucional

Script: JurisprudenciaN/back/scripts/dev/institutional-incremental-scan.ts; comando protegido node scripts/with-dev-db-guard.cjs institutional-incremental. Lee roots locales read-only y compara checkpoint/manifiesto, stat y hash sólo para altas/cambios; reporta NEW, MODIFIED, MISSING y UNCHANGED. Actualiza manifest/delta y estado de ubicaciones sin borrar CorpusDocument ni tocar originales.

Corrida real 2026-10-08, scan incremental-2026-10-08T03-15-45-362Z: 23.829 UNCHANGED; 0 NEW, 0 MODIFIED y 0 MISSING. SHA del manifiesto 995aad5ab797c6f23bce01d6ad8816f1003ae5c7beaa97a94a00d57d079beae0. No hubo ingestión ni cambios sourceMissing. Un resultado sin cambios valida la ruta idempotente; falta probar altas/cambios/faltantes controlados sobre una fuente de prueba.
