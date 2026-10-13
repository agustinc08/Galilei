# Sprint 10 — E2E autenticado

**DEV E2E: PASS.** Sólo se usa la DB DEV protegida por `scripts/with-dev-db-guard.cjs`; fixtures de curaduría son sintéticos y se limpian.

## Cobertura

- Backend Nest + PostgreSQL: seis roles; login y `/auth/me`; lectura, match y descarga byte-range `206` de PDF Digesto; búsqueda por colección; escritura LECTOR prohibida; catálogo y detalle de collection, topic/tag/membership; cola REVISOR y aprobación batch con actor, acción, documentos y fecha auditados; asociación, estado, selección Jurisprudencia, motivo/historial y creación/edición/lectura de sumario. Suite específica final: 1/1 PASS.
- Browser Edge headless con Next de producción local: LECTOR filtra colección, abre PDF, busca dentro y ve highlight/procedencia; ADMIN abre dashboard. Playwright final: 3/3 (incluye cabeceras de seguridad).
- Suite backend general: 13 suites / 65 pruebas PASS; 5 suites / 14 pruebas omitidas por configuración existente.
- Scan incremental protegido final: 23.829 `UNCHANGED`, cero altas/cambios/faltantes, sin tocar los originales.

Reviewer, Jurisprudencia y Digesto ejercitan APIs reales; browser smoke cubre LECTOR y ADMIN. La aceptación guiada con personas reales sigue pendiente.
