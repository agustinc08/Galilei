# Guía humana para revisar estructura de fallos

Esta guía sirve para anotar los paquetes `civil-gold-v1`. Revise sólo decisiones publicadas y activas incluidas en el paquete. No copie el PDF ni agregue datos personales del expediente.

## Procedimiento

1. Abra el fallo completo, página por página. Revise el texto fuente antes de mirar cualquier archivo de candidatos automáticos.
2. Anote cada encabezado real que organice el razonamiento o la parte dispositiva. Registre página PDF (índice desde 1), texto literal, tipo, ordinal si aparece y una nota breve sólo si hay ambigüedad.
3. Incluya `VISTOS`, `RESULTA/RESULTANDO`, `CONSIDERANDO`, consideraciones numeradas, `RESUELVE/FALLO/parte dispositiva` y otros encabezados estructurales verdaderos.
4. No anote títulos corridos, encabezados de página, nombres de partes, citas, texto en mayúsculas sin función estructural ni números de página impresos como secciones.
5. Si revisó todo el documento y no hay encabezados estructurales, use `noStructuralHeading: true` y deje `sections` vacío. Si hay encabezados, marque `noStructuralHeading: false`.
6. Después de terminar la anotación independiente, un coordinador puede compartir el archivo separado `_recovery-work/galilei-editorial-gold-recall-suite4/machine-evaluation/parser-candidates.jsonl` para revisar posibles omisiones y falsos encabezados. No lo abra antes de completar la primera pasada; la salida del parser nunca es una etiqueta esperada.
7. Marque `HUMAN_REVIEW_COMPLETE`, `exhaustive: true`, un ID seudónimo y fecha/hora ISO. Si no pudo inspeccionar todo el documento, no lo marque completo.

## Tipos permitidos

`VISTOS`, `RESULTANDO`, `RESULTA`, `CONSIDERANDO`, `NUMBERED_CONSIDERATION`, `RESUELVE`, `FALLO`, `OTHER_HEADING`.

Use `OTHER_HEADING` sólo para una cabecera estructural real que no corresponda a los tipos anteriores; explique brevemente cuál es su función. No infiera secciones ausentes ni normalice el texto literal.

## Formato

Edite una línea JSON por cada documento asignado en `structure-labels-template.jsonl`. Mantenga exactamente `sampleId`, `documentId` y `sourceHash`. El validador verifica que la página exista en el texto fuente y que la forma del registro sea válida. El importador no usa IA ni parser para completar etiquetas.
