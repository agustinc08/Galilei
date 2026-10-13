# Resultado Misión 5.4 — Performance PostgreSQL Search

**Fecha:** 2026-10-07 · **Objetivo:** decidir si PostgreSQL puede ser base para continuar la integración DEV; no es certificación productiva.

## Antes y después

La mediana de los 13 p50 por familia bajó de **1621.4 ms** a **709.1 ms** (−56.3%). El peor p50 bajó de **2956.4 ms** (booleano complejo) a **1084.4 ms** (phrase). El mayor p95 de esas 13 familias bajó de **2980.5 ms** a **1155.3 ms**. En ocho repeticiones, nearest-rank p95 coincide con max. Se añadió una prueba enfocada de 20 repeticiones para un sufijo positivo: `%civil` devuelve 15.283 resultados con p50 870.9 ms, p95 932.8 ms y máximo 972.4 ms; está bajo el gate y no se mezcla con la mediana de las 13 familias.

| Familia | p50 antes | p50 después | p95 después | Mejora p50 |
|---|---:|---:|---:|---:|
| Identificador candidato (1113) | 1197.4 ms | 178.0 ms | 759.0 ms | 85.1% |
| Campo `numeroSentencia:1113` (medición adicional, 20 repeticiones) | — | 55.6 ms | 148.1 ms | caso adicional |
| TERM | 1566.6 ms | 648.7 ms | 656.6 ms | 58.6% |
| PHRASE | 2051.1 ms | 1084.4 ms | 1112.3 ms | 47.1% |
| AND | 1685.6 ms | 889.9 ms | 925.2 ms | 47.2% |
| OR | 2482.2 ms | 902.6 ms | 969.8 ms | 63.6% |
| NOT | 2359.2 ms | 1064.5 ms | 1155.3 ms | 54.9% |
| FIELD | 1527.4 ms | 609.9 ms | 708.2 ms | 60.1% |
| PREFIX | 1930.3 ms | 966.6 ms | 1004.9 ms | 49.9% |
| SUFFIX | 1621.4 ms | 8.7 ms | 9.4 ms | 99.5% |
| SUFFIX con coincidencias (`%civil`, 20 repeticiones) | — | 870.9 ms | 932.8 ms | caso adicional |
| Booleano complejo | 2956.4 ms | 897.6 ms | 979.3 ms | 69.6% |
| Texto con ranking | 1517.4 ms | 709.1 ms | 822.9 ms | 53.3% |
| Término corto `de` | 509.0 ms | 438.8 ms | 500.1 ms | 13.8% |
| Término corto `a` | 499.7 ms | 419.3 ms | 463.1 ms | 16.1% |

## Paridad y calidad

- Benchmark legacy completo: **40/40 PASS**, cero diferencias en conjuntos de IDs. El reporte 29 original de Misión 5.3 se preservó; la repetición 5.4 está en `35-benchmark-parity-postgresql.json`.
- Pruebas PostgreSQL opt-in: **7/7 PASS**; incluyen normalización española, frase, operadores, prefijo/sufijo, parametrización, publicación y score explicable.
- Suite general: **41 PASS, 7 PostgreSQL opt-in omitidas** en esa ejecución; build Nest PASS; `tsc --noEmit` PASS.
- Prisma Client 7.8.0 generado; 6 migraciones al día; 22 tablas y fixture sin cambios. No hubo migración nueva ni escritura estructural.
- La búsqueda `numeroSentencia:1113` se mantuvo en 55.6 ms p50 / 148.1 ms p95 local; su plan sí hace Seq Scan por la normalización aplicada a la columna. Esto no bloquea continuar integración DEV, pero debe revalidarse con un corpus mayor y diseñar un índice funcional representable si se vuelve cuello de botella.

## Gate provisional

No se encontró en los documentos un SLA aprobado. Para decidir continuidad —no producción— se usa un gate temporal explícito: p50 por familia ≤1.1 s y p95 ≤1.2 s en el corpus local, page size 25 y hardware del informe 33. Las 13 familias cumplen. El corpus es pequeño y no mide concurrencia; esos límites se deben reemplazar por SLO acordado y validar con volumen real antes de producción.

## Dictamen

# POSTGRESQL SEARCH — GO PARA INTEGRACIÓN

Autoriza continuar la integración en desarrollo sobre el endpoint/UI después de validar ACL y contrato de producto. No declara listo el producto para producción ni elimina la medición de COUNT/carga en la próxima escala de corpus.

## Siguiente fase

Cerrar el gate de performance de Fase 5 y comenzar **Fase 6 — Corpus Documental Civil**: fuente autorizada, ingesta, checksum, procedencia, extracción, indexación, búsqueda y documento navegable. No reabrir la auditoría de Search salvo evidencia contradictoria.

Mediciones complementarias de 20 repeticiones: `35-performance-suffix_matching.json` y `35-performance-identifier_field.json`.
