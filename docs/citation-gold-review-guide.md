# Guía de revisión de citas

Esta guía cubre también el benchmark exhaustivo `civil-gold-v1`. Sus paquetes se revisan manualmente; las sugerencias automáticas se mantienen aparte y nunca son ground truth.

## Propósito

La cola de revisión ayuda a comprobar una referencia detectada. No sustituye el fallo fuente ni convierte la cita automáticamente en una relación verificada.

## Revisión recomendada

1. Abra la página fuente indicada y confirme que el texto original corresponde al `rawCitation`.
2. Compare offsets, tipo de texto, contexto y checksum/extracción de origen.
3. Revise los campos parseados y busque el posible fallo destino en fuentes autorizadas.
4. Confirme sólo si la identidad y la relación entre los fallos están probadas.
5. Rechace patrones mal clasificados; deje sin resolver los datos incompletos o ambiguos.

Los expedientes acumulados pueden hacer que otra carátula pertenezca al mismo pronunciamiento. Un número similar, una Sala o una fecha no bastan por sí solos. Las abreviaturas de año no se completan por suposición. Las citas normativas quedan separadas de las citas a fallos.

## Revisión exhaustiva de `civil-gold-v1`

1. Revise todas las páginas del fallo antes de mirar `parser-candidates.jsonl`. El paquete tiene el texto extraído completo por página y un catálogo de metadatos de fallos publicados/activos.
2. Anote cada referencia jurídica literal dentro del alcance, con página, familia, campos que aparecen explícitamente, y destino sólo si coincide con evidencia identificadora exacta del catálogo. Incluya `STATUTE_ONLY` para normas; no las convierta en vínculos entre fallos.
3. Marque `UNIQUE`, `AMBIGUOUS`, `UNRESOLVED`, `SELF_REFERENCE` o `STATUTE_ONLY`. Para destinos ausentes o no únicos, clasifique la razón con evidencia: falta de destino en corpus, metadatos insuficientes, campos insuficientes, normalización, múltiples destinos, registro inactivo/no publicado o tribunal externo no soportado.
4. Registre los negativos seleccionados como `DO_NOT_DETECT` y `OUT_OF_SCOPE`; explique la razón. No agregue como cita toda mención de un tribunal, una norma o un número si el contexto no la usa como referencia jurídica.
5. Sólo después de completar la lectura independiente un coordinador puede compartir `_recovery-work/galilei-editorial-gold-recall-suite4/machine-evaluation/parser-candidates.jsonl` para buscar omisiones o detecciones falsas. Un candidato no es una relación verificada.
6. Use el ID de documento, hash y páginas del paquete sin alterarlos. Complete `HUMAN_REVIEW_COMPLETE`, `exhaustive: true`, un identificador seudónimo y fecha ISO sólo si revisó el texto completo.

El formato exacto y los valores permitidos están en `server/test-fixtures/legal-gold/civil-gold-v1/schema/citation-label.schema.json`. Ejecute `pnpm --filter back run legal-gold:validate` antes de importar. No se debe agregar texto privado, nombres de revisores ni datos ajenos al fallo.

## Campos de procedencia

La migración 35 añade extracción, checksum, versión del parser, familia, campos parseados, página, offsets, tipo de texto, contexto, resultado/razón de resolución y `occurrenceKey`. La clave estable distingue ocurrencias dentro de una extracción; `rawCitation` sigue siendo el texto literal detectado.

## Estados

El resultado automático `RESOLVED_UNIQUE` sólo propone un destino público/activo único. La cola mantiene `DETECTED_CANDIDATE`; la verificación requiere la acción de una persona autorizada y queda en el flujo de auditoría existente. La UI no presenta los candidatos como citas verificadas.

Para auditorías repetibles, usar el fixture `argentine-citation-parser-v2.gold.json` de 100 ejemplos sintéticos de regresión y la guía de patrones reales. El fixture prueba comportamiento del parser; no reemplaza una muestra jurídica de referencia ni es ground truth de recall.
