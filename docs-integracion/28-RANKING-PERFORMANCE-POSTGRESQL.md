# Ranking y performance PostgreSQL — diseño y medición pendiente

## Estado comprobado

No se ejecutaron consultas de benchmark ni `EXPLAIN (ANALYZE, BUFFERS)` contra PostgreSQL: la instancia local todavía no está instalada. No se presentan latencias, planes ni afirmaciones de que los índices sean eficaces. El adaptador aún no existe.

## Índices ya declarados por la migración del proyecto

La migración `20260511120000_search_performance_indexes` existente solicita `pg_trgm`; crea índices B-tree para publicación/actividad/fecha, PDF y filtros de sala/tipo/tribunal; y GIN con `gin_trgm_ops` para campos de identificador, expediente, carátula, magistrados y texto normalizado de Sentencia, además de número, tema, texto y texto normalizado de Sumario.

Esos índices son parte de una migración existente, no evidencia de que sirvan para cada plan ni una autorización para añadir más. Aplicar la migración sólo después de comprobar que el destino es la DB local DEV. Revisar tamaño, selectividad, condición de operador y planes reales. No cambiarla ni sumar índices especulativos en esta etapa.

`pg_trgm` es una extensión distribuida con PostgreSQL 16. La documentación oficial la clasifica como confiable y permite que un propietario con privilegio `CREATE` en la base la instale. Validar el resultado de la migración; no instalar extensiones de terceros.

## Ranking v1 a validar

El orden propuesto, todavía no medido ni implementado, es: (1) identificador exacto de expediente/sentencia/sumario; (2) frase exacta; (3) coincidencia exacta en campo específico; (4) texto completo; (5) similitud trigram cuando corresponda. Score y componentes serán inspeccionables internamente; el API no mostrará SQL. Ranking no debe cambiar `total` ni saltarse filtros/ACL.

La comparación legacy ordenado por fecha debe mantenerse separada de una política moderna de relevancia. Todo orden incluye desempate estable. Prefijo y sufijo se miden por separado; una búsqueda sufija puede no aprovechar un índice trigram si el patrón no aporta trigramas selectivos. Registrar regresiones observadas.

## FTS y español

No hay decisión aprobada de adopción FTS: todavía se deben evaluar `to_tsvector`, configuración de idioma y query builders frente a casos reales. FTS no sustituye la gramática de consulta ni resuelve por sí solo `ñ` versus `n`, palabras de una letra o equivalencia de acentos. No aplicar `unaccent` sin probar que preserve la distinción de `Peña` y `Pena`; `prescripción`/`prescripcion` debe verificarse explícitamente. Mayúsculas deben ser equivalentes. Los términos `a` y `de` no se eliminarán automáticamente mientras el benchmark legacy los soporte.

## Protocolo pendiente

Con fixture comparable instalada:

1. Ejecutar warm-up y varias repeticiones por categoría (ID exacto, frase, campo, texto, trigram, prefijo y sufijo), con parseMs, dbMs y totalMs.
2. Reportar p50, p95, máximo y número de iteraciones; describir host, versiones, estado de caché y tamaño del corpus.
3. Ejecutar `EXPLAIN (ANALYZE, BUFFERS)` para consultas representativas en DB DEV; guardar texto de plan sin credenciales ni datos sensibles.
4. Revisar Seq Scan, Index Scan, Bitmap/GIN, filas estimadas/observadas y buffers. Decidir índices sólo a partir de consultas reales y selectividad.
5. Repetir benchmark SQLite/PostgreSQL sobre el mismo conjunto de legacyId; documentar diferencias intencionales y errores.

## Resultado

FTS, estrategia de ranking, rendimiento, planes y necesidad de índices adicionales permanecen **PENDIENTES**. Ninguna medición se simuló ni se derivó de las latencias SQLite de la Misión 5.1.
