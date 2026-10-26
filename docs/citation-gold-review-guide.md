# Guía de revisión de citas

## Propósito

La cola de revisión ayuda a comprobar una referencia detectada. No sustituye el fallo fuente ni convierte la cita automáticamente en una relación verificada.

## Revisión recomendada

1. Abra la página fuente indicada y confirme que el texto original corresponde al `rawCitation`.
2. Compare offsets, tipo de texto, contexto y checksum/extracción de origen.
3. Revise los campos parseados y busque el posible fallo destino en fuentes autorizadas.
4. Confirme sólo si la identidad y la relación entre los fallos están probadas.
5. Rechace patrones mal clasificados; deje sin resolver los datos incompletos o ambiguos.

Los expedientes acumulados pueden hacer que otra carátula pertenezca al mismo pronunciamiento. Un número similar, una Sala o una fecha no bastan por sí solos. Las abreviaturas de año no se completan por suposición. Las citas normativas quedan separadas de las citas a fallos.

## Campos de procedencia

La migración 35 añade extracción, checksum, versión del parser, familia, campos parseados, página, offsets, tipo de texto, contexto, resultado/razón de resolución y `occurrenceKey`. La clave estable distingue ocurrencias dentro de una extracción; `rawCitation` sigue siendo el texto literal detectado.

## Estados

El resultado automático `RESOLVED_UNIQUE` sólo propone un destino público/activo único. La cola mantiene `DETECTED_CANDIDATE`; la verificación requiere la acción de una persona autorizada y queda en el flujo de auditoría existente. La UI no presenta los candidatos como citas verificadas.

Para auditorías repetibles, usar el fixture `argentine-citation-parser-v2.gold.json` de 100 ejemplos sintéticos de regresión y la guía de patrones reales. El fixture prueba comportamiento del parser; no reemplaza una muestra jurídica de referencia ni es ground truth de recall.
