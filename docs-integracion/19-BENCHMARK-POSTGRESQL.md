# 19 — Benchmark PostgreSQL

## Resultado de esta misión

PostgreSQL no se inició y no se ejecutaron consultas contra él: Docker Desktop/CLI y WSL2 no están disponibles en este entorno, y la sesión no es elevada. Por eso, los 55 casos figuran como NO APLICA para la medición PostgreSQL. Esto no significa que hayan pasado ni que hayan fallado.

La columna Legacy SQLite reproduce los valores guardados en el benchmark histórico. No es una nueva ejecución. Las mediciones PostgreSQL, la comparación de conjuntos y los tiempos de esta misión siguen pendientes.

| Caso | Consulta | Legacy SQLite | PostgreSQL | Semántica esperada | Estado |
|---|---|---:|---:|---|---|
| BJC-001 | daño | 2708 | No ejecutado | Termino presente en resumen materializado. | NO APLICA |
| BJC-002 | DAÑO | 2708 | No ejecutado | Debe recuperar igual que daño. | NO APLICA |
| BJC-003 | dano | 1 | No ejecutado | Contrastar dano con daño; ñ es letra distinta en legado. | NO APLICA |
| BJC-004 | moral | 1294 | No ejecutado | Término jurídico de alta frecuencia. | NO APLICA |
| BJC-005 | daño * moral | 995 | No ejecutado | Ambos términos deben aparecer. | NO APLICA |
| BJC-006 | daño + moral | 3007 | No ejecutado | Al menos uno de los términos debe aparecer. | NO APLICA |
| BJC-007 | daño - moral | 1713 | No ejecutado | daño y ausencia de moral. | NO APLICA |
| BJC-008 | "daño moral" | 956 | No ejecutado | Secuencia contigua daño moral. | NO APLICA |
| BJC-009 | accident% | 3269 | No ejecutado | Términos que comienzan con accident. | NO APLICA |
| BJC-010 | %accident | 0 | No ejecutado | Términos que terminan con accident. | NO APLICA |
| BJC-011 | responsabilidad | 4758 | No ejecutado | Vocabulario civil frecuente. | NO APLICA |
| BJC-012 | "responsabilidad civil" | 413 | No ejecutado | Frase legal frecuente. | NO APLICA |
| BJC-013 | contrato | 3064 | No ejecutado | Vocabulario civil frecuente. | NO APLICA |
| BJC-014 | consumo | 285 | No ejecutado | Vocabulario civil frecuente. | NO APLICA |
| BJC-015 | amparo | 674 | No ejecutado | Vocabulario judicial frecuente. | NO APLICA |
| BJC-016 | accidente | 3155 | No ejecutado | Término relacionado con accidente/responsabilidad. | NO APLICA |
| BJC-017 | salud | 600 | No ejecutado | Término civil y constitucional. | NO APLICA |
| BJC-018 | prueba | 2572 | No ejecutado | Término procesal frecuente. | NO APLICA |
| BJC-019 | ley | 7831 | No ejecutado | Debe conservarse como término indexable. | NO APLICA |
| BJC-020 | de | 25003 | No ejecutado | Legacy la busca como palabra; el parser moderno la filtra. | NO APLICA |
| BJC-021 | a | 21655 | No ejecutado | Legacy permite palabra simple; moderno la descarta. | NO APLICA |
| BJC-022 | 1113 | 599 | No ejecutado | Contrastar texto libre con entidades de referencia modernas. | NO APLICA |
| BJC-023 | 2015 | 39 | No ejecutado | No confundir búsqueda de texto con filtro de fecha. | NO APLICA |
| BJC-024 | daño + contrato | 5449 | No ejecutado | daño o contrato; la lista legacy limita resultados a 300. | NO APLICA |
| BJC-025 | daño * responsabilidad * civil | 658 | No ejecutado | Los tres términos son obligatorios. | NO APLICA |
| BJC-026 | daño - moral - accidente | 1099 | No ejecutado | daño sin moral ni accidente. | NO APLICA |
| BJC-027 | daño AND moral | Error sintáctico | No ejecutado | AND explícito en moderno. | NO APLICA |
| BJC-028 | daño OR moral | Error sintáctico | No ejecutado | OR explícito en moderno. | NO APLICA |
| BJC-029 | daño -moral | 1713 | No ejecutado | En ambos parsers se puede representar como daño menos moral. | NO APLICA |
| BJC-030 | sala:A | 0 | No ejecutado | Legacy lo interpreta como término libre; moderno como filtro de sala. | NO APLICA |
| BJC-031 | daño [filtro sala=A] | 288 | No ejecutado | Término daño limitado a sala A; filtro de interfaz, no gramática textual. | NO APLICA |
| BJC-032 | daño [fecha 2015] | 93 | No ejecutado | Término daño dentro del rango 2015; comparar con filtro anio. | NO APLICA |
| BJC-033 | tema:daños | 9798 | No ejecutado | Filtro/campo de tema moderno; control legacy por texto daños. | NO APLICA |
| BJC-034 | expediente:{valor del corpus redactado} | not_comparable | No ejecutado | Verificar número exacto y preservación de guiones. | NO APLICA |
| BJC-035 | actor:{valor del corpus redactado} | not_comparable | No ejecutado | Consulta exacta en campo, valor omitido por privacidad. | NO APLICA |
| BJC-036 | demandado:{valor del corpus redactado} | not_comparable | No ejecutado | Consulta exacta en campo, valor omitido por privacidad. | NO APLICA |
| BJC-037 | magistrados:{valor del corpus redactado} | not_comparable | No ejecutado | Consulta exacta en campo, valor omitido por privacidad. | NO APLICA |
| BJC-038 | caratula:{valor del corpus redactado} | not_comparable | No ejecutado | Consulta exacta en campo, valor omitido por privacidad. | NO APLICA |
| BJC-039 | sala:A | 0 | No ejecutado | Valor de sala observado en el snapshot; filtro separado en legacy. | NO APLICA |
| BJC-040 | tipoFallo:L | field_filter_not_supported_by_legacy_public_ui | No ejecutado | Valor de tipo L presente en snapshot; no hay filtro equivalente en consulta pública legacy. | NO APLICA |
| BJC-041 | numeroSentencia:{valor del corpus redactado} | not_comparable | No ejecutado | Valor omitido por privacidad; ejecutar con un ID de prueba aprobado. | NO APLICA |
| BJC-042 | numeroSumario:{valor del corpus redactado} | not_comparable | No ejecutado | Valor omitido por privacidad; ejecutar con un ID de prueba aprobado. | NO APLICA |
| BJC-043 | 1113 | 599 | No ejecutado | Legacy solo busca resumen; tb_microisis.referencias_normativas no se consulta. | NO APLICA |
| BJC-044 | Peña | 61 | No ejecutado | Par sensible: medir solo agregados y no mostrar filas/IDs. | NO APLICA |
| BJC-045 | Pena | 108 | No ejecutado | Comparar con Peña; solo conteos agregados. | NO APLICA |
| BJC-046 | prescripción | 1107 | No ejecutado | Legacy query mapping tiene defecto para í; medir el conteo. | NO APLICA |
| BJC-047 | prescripcion | 1107 | No ejecutado | Control para prescripción; comparar normalización. | NO APLICA |
| BJC-048 | zzzxqv | 0 | No ejecutado | Consulta sintética de control sin exponer registros. | NO APLICA |
| BJC-049 | daño + responsabilidad | 6250 | No ejecutado | Medir límite legacy de 300 y OR. | NO APLICA |
| BJC-050 | * daño | Error sintáctico | No ejecutado | El parser legacy requiere palabra antes del operador. | NO APLICA |
| BJC-051 | daño + | Error sintáctico | No ejecutado | Operador sin término derecho. | NO APLICA |
| BJC-052 | daño * moral * accidente * contrato * salud * amparo * consumo | Error sintáctico | No ejecutado | Legacy informa exceso de términos; definir límite común. | NO APLICA |
| BJC-053 | (daño OR moral) | Error sintáctico | No ejecutado | Legacy no soporta agrupación; parser moderno no ofrece AST de agrupación estable. | NO APLICA |
| BJC-054 | daño + moral * accidente | 2729 | No ejecutado | Match daño, or match both moral and accidente. | NO APLICA |
| BJC-055 | daño OR (moral AND accidente) | Error sintáctico | No ejecutado | daño OR (moral AND accidente), no todos los términos a la vez. | NO APLICA |

## Resumen

- Casos del benchmark: 55
- PASS PostgreSQL: 0
- FAIL PostgreSQL: 0
- PARCIAL PostgreSQL: 0
- NO APLICA: 55
- Promedio, p50 y p95 de PostgreSQL: no disponibles; no hubo ejecución.

## Lectura y límites

Los resultados legacy sirven como referencia de semántica y conteos, pero no alcanzan para afirmar equivalencia. Antes de comparar se debe usar el mismo subconjunto reproducible, aplicar idénticos filtros de actividad/visibilidad, comparar IDs y totales, y evaluar el ranking moderno por separado del orden legacy por fecha.

Los casos con sintaxis no admitida por SQLite legacy pueden seguir siendo válidos para evaluar la semántica moderna. Se debe registrar por separado el resultado del parser y el resultado de base de datos. Ningún error de parser debe transformarse en SQL.

La prueba pendiente debe ejecutar los 55 casos aplicables contra una fixture PostgreSQL controlada, conservar la consulta, AST, parámetros de prueba, total, IDs esperados/obtenidos, candidatos y tiempos de parser/DB/total. Los valores personales o casos redactados del benchmark requieren fixture aprobada; este informe no los desanonimiza.

Fuente histórica: docs-integracion/benchmark-busqueda.json, versión audit-2026-10, 55 casos. La medición histórica corresponde a SQLite read-only y el campo modernExecution está en not_run.
