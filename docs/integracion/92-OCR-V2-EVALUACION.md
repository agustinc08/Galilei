# Evaluación OCR V2 — Sprint 12

**Decisión: no ampliar el lote.** No existe una muestra aprobada de 30–50 páginas con transcripción humana o copia digital equivalente y revisión visual. Inventar ground truth invalidaría CER/WER. No se ejecutó OCR sobre otros documentos ni se modificaron extracciones persistidas.

La evidencia disponible sigue siendo Sprint 11: dos páginas del mismo documento, Tesseract 5.5.3, español, render 300 dpi, PSM 4. Página 1: CER 62,17%→4,80%, WER 69,51%→6,44%; página 2: CER 90,07%→5,09%, WER 92,92%→4,57%. Es mejora dirigida, no muestra representativa; requiere revisión visual humana. Fuentes originales permanecen intactas.

Pipeline candidato para validar: render 300 dpi, orientación/detección, deskew y contraste sólo cuando haga falta, idioma `spa`, PSM comparado por layout. No declararlo OCR_OK_FOR_SEARCH global. Mantener `OCR_REVIEW_REQUIRED`/`OCR_REQUIRED` según política existente. El PDF original sigue siendo la fuente jurídica; OCR sólo habilita búsqueda y navegación. No hay CER/WER global ni expansión 50–100 documentos.
