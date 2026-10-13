# EXPLAIN y evaluación de performance PostgreSQL

**Misión:** 5.3 · **Estado:** MEDIDO; tuning pendiente · **Fecha:** 2026-10-07

## EXPLAIN (ANALYZE, BUFFERS)

Las cinco consultas de prueba se ejecutaron como `SELECT` en la base DEV y se guardaron en `30-explain-postgresql.json`.

| Caso | Nodo principal | Índice elegido | Tiempo observado |
|---|---|---|---:|
| Contiene normalizado `daño` | Hash Join | ninguno | 250.877 ms |
| Prefijo legacy `accident%` | Hash Join | ninguno | 218.390 ms |
| Sufijo legacy `%accident` | Hash Join | ninguno | 196.270 ms |
| ID exacto de Sentencia | Index Only Scan | `Sentencia_pkey` | 0.011 ms |
| `to_tsvector('spanish', ...)` para `daño` | Gather / Seq Scan | ninguno | 1548.230 ms |

En contains/prefix/suffix el plan hizo Seq Scan sobre `Sumario` y `Sentencia`, más Hash Join. Los índices GIN/trigram existentes no fueron elegidos por el plan para estas selecciones y tamaño de fixture. El caso FTS construye `to_tsvector` en cada fila; no existe una columna/vector indexado para esta prueba. No se agregó un índice especulativo.

## Normalización FTS

La sonda del parser `spanish` produjo la misma consulta `'prescripcion'` para `prescripción` y `prescripcion`. Conservó distinción: `Peña` produjo `'peñ'` y `Pena` produjo `'pen'`. Es evidencia de una prueba built-in, no adopción de FTS como motor del producto. No se usa `unaccent`.

## Estado de ranking y decisión

El adapter implementa score explicable. Para limitar el costo medido, la similitud trigram sólo se calcula en consultas con campo explícito; no se aplica similitud a cada documento entero. FTS tampoco se adopta por ahora. El plan exacto por identificador sí usa índice, mientras que las búsquedas de texto presentan tiempos mayores que SQLite (ver `31-BENCHMARK-PARIDAD-POSTGRESQL.md`).

La decisión de esta misión es conservar el adapter como implementación experimental local, no conectarlo aún al endpoint. Próxima fase: perfilar por separado el `COUNT`, selección de candidatos, ranking y paginación; comparar operadores/indexes trigram con selectividades reales; repetir EXPLAIN y benchmark antes de sumar índices o declarar GO.
