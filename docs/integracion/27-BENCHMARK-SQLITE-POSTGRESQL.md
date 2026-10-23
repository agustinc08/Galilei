# Benchmark SQLite vs PostgreSQL — protocolo y estado

## Estado de ejecución

No hay instancia PostgreSQL instalada en este entorno. Por lo tanto, el adaptador PostgreSQL no está implementado, no existe fixture en PostgreSQL y no se ejecutó comparación SQLite/PostgreSQL. El archivo `benchmark-busqueda.json` se conserva sin modificaciones. No se informan PASS, FAIL, conteos ni diferencias de paridad atribuidos a PostgreSQL.

La Misión 5.1 dejó una línea base separada: 5 suites / 35 tests PASS para el Search Spike sobre SQLite histórica read-only y `pnpm build` con exit code 0. No son resultados de PostgreSQL.

## Corpus comparable

La comparación sólo será válida sobre exactamente los mismos registros. La fixture se generará desde una copia lógica de lectura de SQLite legacy en modo read-only, `immutable=1` y `PRAGMA query_only=ON`. No actualizar ni modificar la base legacy. No importar `tb_microisis`.

Regla determinista propuesta para implementar y documentar antes de importar: tomar la unión de IDs legacy que participan en los casos aplicables del benchmark y complementar, si fuera necesario, con una muestra estable ordenada por `legacyId` hasta el tamaño de fixture acordado. Registrar el algoritmo/semilla si hay muestreo, IDs seleccionados y huella SHA-256 del manifiesto. Preservar `legacyId`, `legacySource` y `legacyTable` o equivalentes existentes. No ajustar manualmente la selección después de ver los resultados. La cantidad concreta queda pendiente de inspección del origen y no se inventa en esta auditoría.

Cada ejecución SQLite y PostgreSQL debe consultar ese mismo conjunto de IDs y misma política de visibilidad/publicación. Si una consulta requiere filas fuera del fixture, clasificarla `NOT_COMPARABLE`, no enfrentar conteos de corpus distintos.

## Procedimiento

1. Mantener intactos los 55 casos de `benchmark-busqueda.json`; registrar versión/hash del archivo.
2. Marcar aplicabilidad y capturar consulta AST, filtros, contexto, universo de IDs y resultados completos paginados de ambos adapters.
3. Comparar total e identidad usando `legacyId`; calcular `intersection`, `legacy_only`, `postgres_only` y diferencia de orden/ranking aparte.
4. Clasificar cada caso: `PASS_COMPAT`, `PASS_MODERN`, `PASS_INTENTIONAL_DIFFERENCE`, `FAIL`, `NOT_COMPARABLE` o `REDACTED`, con razón breve y evidencia reproducible.
5. No mezclar paridad semántica con ranking: primero comparar el conjunto; después registrar orden y score en una columna aparte.

## Métricas

Registrar versión de Windows/PostgreSQL/Prisma, hardware disponible, tamaño/huella de fixture, configuración de DB, warm-up, número de repeticiones y caché fría/caliente cuando sea posible. Medir parseMs, dbMs y totalMs. Para cada conjunto de ejecuciones reportar p50, p95, máximo y número de muestras; no presentar microbenchmarks de una sola ejecución como rendimiento.

## Bloqueo actual y salida esperada

La única barrera previa es la instalación humana descrita en `25-POSTGRESQL-WINDOWS-LOCAL.md`. Hasta confirmar la base DEV local, todo benchmark PostgreSQL permanece pendiente y no hay conclusión de paridad.
