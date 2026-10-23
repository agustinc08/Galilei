# Sprint 10 — Validación de OCR

**Dictamen: PILOTO CON AJUSTES; no ampliar el lote.**

Ground truth: 20 páginas de 11 PDFs, idioma español, Tesseract 5.5.3 con modelo `spa` (SHA-256 `e2c1ffdad8b30f26c45d4017a9183d3a7f9aa69e59918be4f88b126fac99ab2c`) a 160 DPI. Referencia: text layer nativa de los mismos PDFs; entrada OCR: rasterización. CER agregado 19,43% (5.246 / 26.996 caracteres); WER 28,97% (1.408 / 4.860 palabras). Dos páginas de un mismo PDF dieron CER 62,17% y 90,07%, WER 69,51% y 92,92%. La variación impide aceptar OCR automático; el orden de lectura multicolumna también puede afectar la referencia nativa.

No se amplió OCR. Los 14 PDFs Digesto sin text layer y los pendientes Corpus esperan tratamiento selectivo y revisión visual de nombres, expedientes, cifras, `ñ` y tildes. Originales intactos. Evidencia: `_recovery-work/sprint10/ocr/ground-truth-898663a5-eb52-4946-aace-f56c3e808bdf/ground-truth-report.json`.
