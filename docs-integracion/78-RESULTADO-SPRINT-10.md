# Sprint 10 — Pilot readiness

**Dictamen: READY FOR PILOT CON AJUSTES.** Una persona puede realizar una prueba guiada en DEV con acompañamiento; no se autoriza producción ni acceso institucional compartido.

## Resultados

- **Digesto:** 278 PDFs / 197.541.924 bytes / 276 hashes únicos / 2 duplicados; 278 válidos, 0 inválidos, 264 con texto, 14 `OCR_REQUIRED`; 0 hashes previos en Corpus. Import DEV: 276 documentos únicos nuevos, 2 duplicados físicos reutilizan SHA. No se encontró export local de metadata. Una colección marcador; 0 topics/tags importados; IDs/crosswalk legacy pendientes.
- **E2E:** seis roles por API; 13 suites / 65 pruebas generales PASS (5 suites / 14 omitidas); integración PostgreSQL final 1/1 (cola de revisión, sumarios, taxonomy Digesto y curaduría); Playwright 3/3.
- **OCR:** 20 páginas / 11 docs; CER 19,43%, WER 28,97%; 2 páginas de muy baja calidad; no expandir.
- **Incremental:** pruebas deterministas cubren NEW, MODIFIED, MISSING y UNCHANGED; corrida real `incremental-2026-10-08T04-37-51-182Z`: 23.829 UNCHANGED, 0 NEW/MODIFIED/MISSING, 0 rehashes por cambios, 0 marcas/restauraciones sourceMissing; originales read-only.
- **Build:** Prisma generate PASS; migraciones 14/14 al día; backend build PASS; frontend typecheck/build PASS.
- **Jurisprudencia:** asociación revisada, flujo `REVIEW_PENDING → SELECTED` con motivo/nota/historial; API de sumarios probó alta, edición y lectura sobre fixture DEV limpiado.
- **UX, una corrida local:** primer resultado visible en filtro de colección 223 ms, página PDF visible 364 ms y dashboard 1.230 ms. No son SLA ni benchmark de carga. En los logs de integración, la subconsulta Jurisprudencia tardó entre 1,5 y 7,4 s para términos que no matchearon allí; no equivale al tiempo federado total, pero amerita medición de Search con términos reales en Sprint 11.

## Ajustes previos a ampliar

1. Conseguir export local autorizado de metadata Digesto y validar crosswalk/editorial/ACL.
2. Validar OCR selectivamente; no procesar lote adicional todavía.
3. Obtener aceptación humana de Secretaría, Digesto, consulta y administrador; validar permisos institucionales.
4. Definir rate limit, sesión JWT, monitoreo y rendimiento concurrente antes de red compartida/preproducción.
5. Lote auditado implementado para clasificaciones; lote de membership/envío a revisión y undo auditado siguen pendientes.
6. Medir tiempos por adapter, búsqueda completa y cola de revisión con consultas representativas; inspeccionar plan/N+1 antes de establecer expectativa operativa.
7. La administración de cuentas/roles no se cubrió en browser E2E; las cuentas se preparan mediante seed DEV y se valida la autorización de las APIs. Confirmar el flujo administrativo durante la demo guiada.

## Condiciones y siguiente sprint

Usar sólo DEV local, con guía y feedback; evitar decisiones editoriales irreversibles. No acceder a producción, Digesto remoto, CIJ, CSJN, Lex100 ni servidores institucionales.

**Siguiente:** Sprint 11 — VALIDACIÓN CON USUARIOS + CORRECCIONES DEL PILOTO + PREPRODUCCIÓN, sujeto a feedback y resolución priorizada de estos ajustes.
