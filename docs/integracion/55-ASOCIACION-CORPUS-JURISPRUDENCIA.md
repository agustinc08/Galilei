# 55 — Asociación Corpus ↔ Jurisprudencia

## Resultado del preview

La asociación se calculó antes de importar, contra entidades Jurisprudencia existentes. Reporte correcto: `C:\proyecto triple\_recovery-work\sprint8\inventory\1a063011-f3a3-421f-bd11-1ecdf3896bb2\association-preview-1791407188687.json`. No usar el `association-preview.json` anterior: quedó obsoleto y marcaba todos los elementos como `UNRESOLVED`.

| Nivel | Archivos físicos en preview | Documentos únicos en DB | Efecto automático |
|---|---:|---:|---|
| EXACT | 0 | 0 | Ningún vínculo creado |
| HIGH_CONFIDENCE | 29 | 27 | Sólo sugerencia `REVIEW_PENDING` |
| CANDIDATE | 2 | 2 | Sólo sugerencia `REVIEW_PENDING` |
| UNRESOLVED | 23.798 | 10.703 | Estado unresolved |

El preview físico agrupa ubicaciones duplicadas; la DB resume evidencia por documento/hash. Por ello las cantidades de ambas columnas no son intercambiables. Las 10.732 asociaciones persistidas se distribuyen en 27 `HIGH_CONFIDENCE`, 2 `CANDIDATE` y 10.703 `UNRESOLVED`. En ambos runs: `linked=0`, no se creó ninguna Sentencia y no hubo enlace automático. Los 29 casos con evidencia fuerte/candidata permanecen pendientes de decisión humana.

## Evidencia y salvaguardas

Se priorizan relaciones/IDs exactos y referencias documentadas; candidato de filename/metadata no se convierte en verdad. `EXACT` es el único nivel que el importador podría vincular automáticamente si apareciera una referencia explícita validada. `HIGH_CONFIDENCE` y `CANDIDATE` siempre requieren revisión. Los registros de asociación guardan confianza, estrategia/evidencia, origen y review status. El reconciliador corrigió filas derivadas del preview viejo sin reemplazar decisiones `APPROVED` o `REJECTED`.

El PDF puede existir como Corpus aun sin vínculo: `CorpusDocument` conserva procedencia, checksum y todas sus ubicaciones. No se duplicó ni fusionó una Sentencia. La cola administrativa permite filtrar unresolved/candidate, pero en Sprint 8 es de lectura: aprobar, rechazar, enlazar y selección jurisprudencial con motivo quedan en Sprint 9.

## Digesto

Los 278 PDFs del root Digesto fueron inventariados aparte, inactivos/excluidos y no importados. En el corpus institucional real no hay vínculos `targetDomain=Digesto`, Collections, Topics ni Tags conectados. `CorpusDocumentLink` soporta técnicamente vínculos por dominio sin copiar el archivo; la prueba sintética de M6 demostró el patrón Jurisprudencia+Digesto, pero aún falta crosswalk real de ownership/ACL y la integración del módulo.
