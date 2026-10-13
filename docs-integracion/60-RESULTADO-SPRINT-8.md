# 60 — Resultado Sprint 8: Corpus institucional real

**Fecha:** 2026-10-07. **Dictamen:** **SPRINT 8 — GO CON AJUSTES**. El corpus institucional local ya puede buscarse, abrirse y navegarse en DEV; quedan pendientes curaduría humana, Digesto real, OCR, resaltado interno y gates de producción.

## Respuestas de cierre

| Pregunta | Evidencia final |
|---|---|
| ¿Cuántos PDFs reales tenemos? | 23.829 archivos físicos tipo PDF en tres roots de Jurisprudencia; otros 278 PDFs de Digesto quedaron fuera. |
| ¿Cuántos son únicos? | 10.732 SHA-256 únicos; 13.097 copias físicas adicionales exactas. |
| ¿Cuántos ya pertenecían a Jurisprudencia? | 0 links EXACT identificados/creados; 27 documentos con sugerencia HIGH_CONFIDENCE y 2 CANDIDATE, pendientes de revisión. No se creó ninguna Sentencia. |
| ¿Cuántos quedaron Corpus sin resolver? | 10.703 de los 10.732 documentos únicos. |
| ¿Cuántos tienen texto/OCR? | 10.332 INDEXED (96,27 %), 399 OCR_REQUIRED (3,72 %), 1 INVALID_PDF (0,01 %) y 0 FAILED. |
| ¿Cuántos están indexados/clasificados? | 10.332 con texto indexable; 8.667 tienen una o más sugerencias RULE; 21.547 sugerencias, 2.064 documentos sin clasificar. Todas siguen SUGGESTED; 0 aprobadas. |
| ¿Podemos buscarlos? | Sí en el adapter Corpus conectado al fan-out existente. Smoke real: 1 resultado, snippet, match página 1, ACL INTERNAL y 36 ms después de optimizar título. |
| ¿Podemos abrirlos e ir a página? | Sí, visor PDF autenticado y `#page=N`; descarga validada con checksum. |
| ¿Podemos navegar coincidencias? | Sí, panel de contexto y anterior/siguiente, límite de 500. No hay resaltado pintado dentro del PDF nativo. |
| ¿Corpus + Jurisprudencia + Digesto con un solo archivo? | El modelo `CorpusDocumentLink` admite relaciones por dominio sin copiar archivo y el test sintético M6 lo demostró. En el corpus real no hay links a Jurisprudencia ni Digesto aprobados; Digesto aún no está integrado. |

## Datos y corridas

- Manifest: `C:\proyecto triple\_recovery-work\sprint8\inventory\1a063011-f3a3-421f-bd11-1ecdf3896bb2\institutional-pdf-inventory.json`; SHA-256 `4e0f484a1603e5d73787982f630af5006c3906a94323b17e5fa619f162ac0224`.
- Run de ingesta `5a3ececa-3a55-4a08-bd20-bb43ce3e006d`: SUCCESS, 10.732 procesados, 10.727 nuevos, 5 reutilizados, cero errores, 95.392 páginas, 193.289.260 caracteres; p50/p95 extractor 49/360 ms.
- Segunda pasada `90f64ee1-2dac-44b1-b3dc-59df4368a287`: SUCCESS, 0 nuevos, 10.732 reutilizados, 0 fallos. Quedaron 10.732 documentos/archivos/eventos, 23.829 ubicaciones, 95.392 páginas y 10.732 blobs de 2.115.402.746 bytes.
- DB DEV al cierre: 1.043.627.031 bytes. El aumento de tamaño exacto desde el estado preingesta no quedó aislado; a 5.000 items eran 735.886.359 bytes, diferencia hasta el cierre +307.740.672 bytes incluye el corpus restante, clasificación, índice y pruebas.
- Dump final: `C:\proyecto triple\_recovery-work\sprint8\backups\buscador_juridico_civil_dev-pre-sprint8-2026-10-07T22-31-14-193Z.dump`, 220.752.700 bytes, SHA-256 `1952184d7a8223071048e170f0b05cc84178a95e20f4d8579aef323a2842f329`.

## Seguridad y calidad

Las raíces originales permanecieron read-only; no hubo borrados, renombres, movimientos ni sobrescrituras. El storage es content-addressed y los metadatos conservan procedencia. Las escrituras DB pasaron por guard `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`; no se usó producción, DB remota ni servidores institucionales. Los documentos quedaron `visibility=INTERNAL`, `editorialStatus=NO_REVIEWED`, `anonymizationStatus=REVIEW_REQUIRED`; no se publicó ni se anonimiza automáticamente. CIJ/CSJN scraping continúa NO GO según M7. No se ingirieron los 278 PDFs Digesto.

La muestra de clasificación determinista de 100 documentos encontró 268/268 términos de evidencia en el texto, pero no tenía labels aprobados; la precisión semántica no se midió. Clasificación por reglas no es IA ni selección jurisprudencial.

## Validación

- Backend TypeScript: PASS. Backend Jest general: 11 suites/58 tests PASS, 3 suites/12 tests omitidos por configuración/opt-in.
- PostgreSQL Search opt-in: 7/7 PASS; Corpus PostgreSQL: 3/3 PASS; paquete institucional Corpus: 2/2 PASS; tests dirigidos de ingesta/matches/access/fan-out: 13/13 PASS.
- Backend build Nest: PASS. Frontend typecheck: PASS. Next.js production build: PASS (`/busqueda-avanzada`, `/corpus`, `/corpus/[id]`).
- Plan medido con índice de carátula: 3.613,8 ms → 0,333 ms (consulta EXPLAIN específica); smoke completo Search/visor: 36 ms.
- Migraciones aplicadas en DEV: 13; última `20261007220000_sprint8_corpus_title_trgm`. Fuentes de PDFs no cambiaron.

## Ajustes requeridos antes de declarar completo el producto

1. Sprint 9: decisiones humanas de asociación/clasificación, selección con motivo, historial y acciones seguras por lote.
2. Definir canal y modelo autorizado para Digesto, crosswalk ACL/ownership, Collections/Topics/Tags y vínculo real.
3. Diseñar piloto OCR local revisado para 399 documentos; atender el PDF inválido por flujo de revisión.
4. Añadir resaltado dentro del PDF, no sólo contexto y salto de página; validar UI autenticada con usuarios.
5. Implementar scan incremental/sourceMissing con revisión, y deduplicación probable separada de SHA exacto.
6. Acordar ACL/anonimización institucional, retención, SLO y carga concurrente antes de producción. El smoke DEV no equivale a certificación/SLA.

## Siguiente sprint

**Sprint 9 — Workflow real de Jurisprudencia + Digesto + Curaduría**: revisión de las 29 asociaciones, clasificación, selección y motivo, permisos, auditoría, crosswalk Digesto y publicación deliberada; sin convertir sugerencias automáticas en verdad.
