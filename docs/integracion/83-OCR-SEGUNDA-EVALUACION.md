# Segunda evaluación de OCR — Sprint 11

**Estado: evaluación dirigida completada sobre dos páginas; lote OCR sin ampliar y extracciones almacenadas intactas.** Se verificó el SHA del original y se comparó con la misma capa nativa de referencia. Tesseract 5.5.3, modelo español SHA `e2c1ffdad8b30f26c45d4017a9183d3a7f9aa69e59918be4f88b126fac99ab2c`.

| Documento (ID interno) | Páginas | Evaluación | CER antes | WER antes | CER después | WER después | Decisión |
|---|---:|---|---:|---:|---:|---:|---|
| `cmuz0ei0z01ohfg8vr2dswghg` | 1 | Reescalado 300 dpi + PSM 4 | 62,17% | 69,51% | 4,80% | 6,44% | Propuesta para prueba humana; fuente intacta |
| `cmuz0ei0z01ohfg8vr2dswghg` | 2 | Reescalado 300 dpi + PSM 4 | 90,07% | 92,92% | 5,09% | 4,57% | Propuesta para prueba humana; fuente intacta |

Comparadores con PSM 6 siguieron en CER 61,60–61,79% / WER 69,51% para página 1 y CER 90,07% / WER 92,47–92,92% para página 2. La combinación puntual PSM 4 produjo una mejora marcada; es evidencia de sensibilidad a segmentación de página, no una política validada para otros documentos.

El artefacto agregado se guarda en `_recovery-work/sprint11/ocr/targeted-outlier-evaluation.json`; renders y PDF temporal se borraron al finalizar y las extracciones no cambiaron. No incluir texto jurídico extraído en el informe. Mantener `OCR_REQUIRED` hasta revisar visualmente ambas páginas y aprobar calidad, y luego validar el ajuste con muestra adicional autorizada antes de cambiar el pipeline.
