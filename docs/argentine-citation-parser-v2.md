# Parser argentino de citas v2

## Pipeline

1. **Detección:** regexes acotadas sobre texto de página local con límites por página y por total de texto.
2. **Normalización:** sólo identificadores explícitos; conserva el texto original sin sustituirlo.
3. **Parseo:** guarda familia y campos presentes (tribunal, Sala, expediente, número, fecha, Fallos, norma).
4. **Resolución:** expediente exacto contra fallos publicados y activos; Sala/fecha sólo restringen cuando se extrajeron explícitamente.
5. **Revisión:** candidato con página, offsets, extracción, hash fuente y contexto; confirmación/rechazo siguen siendo acciones humanas auditadas.
6. **Relación verificada:** sólo el flujo de revisión existente puede verificar; la detección y la resolución única no cambian ese estado.

Versión: `argentine-citation-parser-v2`. Los offsets son UTF-16 dentro del texto extraído de la página indicada y son 0-based. El número de página es índice PDF 1-based. El contexto retenido para revisión está acotado a 800 caracteres.

Límites de procesamiento: hasta 10.000 páginas de entrada, página de origen entre 1 y 100.000, 1.000.000 caracteres por página y 3.000.000 caracteres totales por documento. El parser rechaza el lote si excede páginas/texto; las coincidencias superpuestas de un mismo identificador se deduplican con recorrido lineal tras ordenar offsets. Las pruebas incluyen 10.000 menciones de expediente repetidas y texto largo malformado.

## Familias actuales

`EXPEDIENTE_IDENTIFIER`, `CIVIL_EXPEDIENTE`, `CNCIV_ROLLO`, `CNCIV_SALA_DATE`, `CSJN_FALLOS`, `CSJN_CASE`, `CSJN_DECISION_DATE`, `OTHER_COURT` y `STATUTE_REFERENCE`. Las normas no se convierten en relaciones jurisprudenciales. Un tribunal sin una señal de referencia no produce candidato de tribunal.

La familia CSJN de número de causa exige forma de docket con sufijo `/CS...`; números institucionales de acordadas como `CSJN 15/2013` no se presentan como casos. Fechas de decisiones CSJN y citas `Fallos` tienen familias separadas. Las variantes `Fallos`, `“Fallos”` y puntuación con coma/dos puntos se cubren por pruebas.

## Estados y seguridad jurídica

- `DETECTED_CANDIDATE`: referencia detectada, todavía no verificada.
- `RESOLVED_UNIQUE`, `AMBIGUOUS`, `UNRESOLVED`, `SELF_REFERENCE`: resultado de resolución exacta, no estado de publicación.
- `VERIFIED`: reservado a revisión humana real y auditada.

No se resuelve por coincidencia aproximada, primer registro, año supuesto, texto generado ni IA. Un candidato ambiguo no elige destino. Un destino privado no forma parte de la consulta; se comparan sólo fallos publicados y activos. La detección automática nunca equivale a hecho jurídico verificado.

## Auditoría y límites

En una muestra read-only de 200 fallos se contaron 6.074 candidatos; 154 autoreferencias exactas se suprimieron. De 689 identificadores normalizables restantes, 68 coincidieron de forma única y 621 quedaron sin destino exacto; ninguno fue ambiguo. La revisión manual de 50 candidatos estratificados encontró referencias válidas en los 50; esta muestra no mide recall ni precisión corpus-wide. Los detalles y las formas observadas están en [investigación](research/argentine-citation-patterns-v2.md).

Las fechas de dos dígitos no reciben siglo. Docket abreviado, documentos con expedientes acumulados, reporterías poco frecuentes y texto OCR pueden quedar sin resolver o requerir revisión. Esa incertidumbre se conserva en el candidato.
