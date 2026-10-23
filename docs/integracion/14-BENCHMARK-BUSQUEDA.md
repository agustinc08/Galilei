# 14 — Benchmark de búsqueda: Buscador Jurídico Civil

## Alcance y método

El benchmark contiene 55 consultas agrupadas por gramática legacy/moderna, texto jurídico, campos, acentos, números, fechas, amplitud, precedencia y errores. Las consultas provienen de los parsers y vocabulario civil existente; la consulta zzzxqv es el control sintético sin resultados. Los valores de nombres de partes, magistrados, carátulas, expedientes y números de registro que podrían identificar causas se redactaron.

Estado de ejecución: 40 casos tienen conteo medido en la SQLite legacy; 7 consultas con valores potencialmente identificatorios quedaron sin ejecutar y redactadas, 7 documentan respuestas de error sintáctico legacy y 1 corresponde a un filtro de campo moderno sin equivalente en la UI legacy. Las cinco comparaciones de intersección/unión se reportan por separado como análisis de resultados, no como consultas adicionales.

El PHP público abre jurisprudencia/jurisp_6/db/jurisprudencia_db.sqlite. Se midieron coincidencias sobre ese snapshot con SQLite en modo immutable/solo lectura. Un helper temporal reprodujo el patrón LIKE y la composición AND/OR/NOT del PHP mediante parámetros enlazados; no se ejecutó el endpoint PHP. Cada fila contabilizada es un sumario y la consulta PHP limita la respuesta a 300 filas, ordenadas por fecha descendente.

PostgreSQL moderno no se midió. La configuración de Jurisprudencia apunta a localhost:5432, pero no se encontró un proceso/listener local; no se intentó conectar. La columna moderna es análisis estático del parser/servicio, no un resultado de ejecución ni un benchmark de latencia.

## Matriz de casos

| ID | Consulta | Intención | Legacy (coincidencias; máx. visibles) | Análisis moderno actual | Riesgo |
|---|---|---|---:|---|---|
| BJC-001 | <code>daño</code> | palabra simple | 2,708; máx. 300 | Paridad estimada: Sí | Baja |
| BJC-002 | <code>DAÑO</code> | mayúsculas/minúsculas | 2,708; máx. 300 | Paridad estimada: Sí | Baja |
| BJC-003 | <code>dano</code> | acentos y ñ | 1; máx. 1 | NFD elimina diacríticos, por lo que ñ y n se colapsan; el legacy las mantiene distintas. | Baja |
| BJC-004 | <code>moral</code> | palabra simple | 1,294; máx. 300 | Paridad estimada: Sí | Baja |
| BJC-005 | <code>daño * moral</code> | AND legacy | 995; máx. 300 | El parser elimina * y la conjunción por defecto hace que el caso simple equivalga a AND; no hay soporte explícito del símbolo. | Baja |
| BJC-006 | <code>daño + moral</code> | OR legacy | 3,007; máx. 300 | + se elimina como puntuación; los dos términos quedan incluidos y el servicio usa AND por defecto. | Alta |
| BJC-007 | <code>daño - moral</code> | exclusión legacy | 1,713; máx. 300 | El guion separado se descarta; ambos términos quedan como incluidos, no como exclusión. | Alta |
| BJC-008 | <code>&quot;daño moral&quot;</code> | frase | 956; máx. 300 | Paridad estimada: Parcial | Media |
| BJC-009 | <code>accident%</code> | wildcard prefijo | 3,269; máx. 300 | % no se interpreta como wildcard; el parser recorta puntuación y conserva el término base. | Alta |
| BJC-010 | <code>%accident</code> | wildcard sufijo | 0; máx. 0 | % no se interpreta como wildcard; el parser recorta puntuación y conserva el término base. | Alta |
| BJC-011 | <code>responsabilidad</code> | palabra simple | 4,758; máx. 300 | Paridad estimada: Sí | Baja |
| BJC-012 | <code>&quot;responsabilidad civil&quot;</code> | frase | 413; máx. 300 | Paridad estimada: Parcial | Media |
| BJC-013 | <code>contrato</code> | tema jurídico | 3,064; máx. 300 | Paridad estimada: Sí | Baja |
| BJC-014 | <code>consumo</code> | tema jurídico | 285; máx. 285 | Paridad estimada: Sí | Baja |
| BJC-015 | <code>amparo</code> | tema jurídico | 674; máx. 300 | Paridad estimada: Sí | Baja |
| BJC-016 | <code>accidente</code> | tema jurídico | 3,155; máx. 300 | Paridad estimada: Sí | Baja |
| BJC-017 | <code>salud</code> | tema jurídico | 600; máx. 300 | Paridad estimada: Sí | Baja |
| BJC-018 | <code>prueba</code> | tema jurídico | 2,572; máx. 300 | Paridad estimada: Sí | Baja |
| BJC-019 | <code>ley</code> | palabra corta | 7,831; máx. 300 | Paridad estimada: Sí | Baja |
| BJC-020 | <code>de</code> | palabra funcional de dos letras | 25,003; máx. 300 | Stopwords eliminan de; términos alfabéticos menores de tres caracteres se descartan. | Alta |
| BJC-021 | <code>a</code> | palabra de una letra | 21,655; máx. 300 | Stopwords eliminan de; términos alfabéticos menores de tres caracteres se descartan. | Alta |
| BJC-022 | <code>1113</code> | número/referencia normativa | 599; máx. 300 | Paridad estimada: Parcial | Media |
| BJC-023 | <code>2015</code> | año como palabra | 39; máx. 39 | Paridad estimada: Parcial | Media |
| BJC-024 | <code>daño + contrato</code> | OR legacy | 5,449; máx. 300 | Paridad estimada: No | Alta |
| BJC-025 | <code>daño * responsabilidad * civil</code> | AND de tres términos | 658; máx. 300 | Paridad estimada: Parcial | Media |
| BJC-026 | <code>daño - moral - accidente</code> | dos exclusiones | 1,099; máx. 300 | Paridad estimada: No | Alta |
| BJC-027 | <code>daño AND moral</code> | sintaxis moderna AND | Error de sintaxis legacy | Reconoce AND como palabra; el servicio trata términos incluidos como conjunción por defecto. | Alta |
| BJC-028 | <code>daño OR moral</code> | sintaxis moderna OR | Error de sintaxis legacy | El parser registra orGroups, pero el filtrado de candidatos también conjuga parsed.terms salvo que se envíe operador=OR aparte; escribir OR en q no parece suficiente. | Alta |
| BJC-029 | <code>daño -moral</code> | NOT moderno unido | 1,713; máx. 300 | El guion adjunto genera exclusión; en el legacy el PHP separa todo guion, por lo que la semántica coincide en este caso. | Media |
| BJC-030 | <code>sala:A</code> | campo vs texto | 0; máx. 0 | Paridad estimada: No | Media |
| BJC-031 | <code>daño [filtro sala=A]</code> | filtro sala legacy | 288; máx. 288 (con filtro UI) | Paridad estimada: Parcial | Media |
| BJC-032 | <code>daño [fecha 2015]</code> | filtro fecha legacy | 93; máx. 93 (con filtro UI) | Paridad estimada: Parcial | Media |
| BJC-033 | <code>tema:daños</code> | campo tema | 9,798; máx. 300 (equiv. texto libre: daños) | El alias de campo existe en el parser; no se midió contra PostgreSQL. Valores personales/identificadores redactados. | Media |
| BJC-034 | <code>expediente:{valor del corpus redactado}</code> | campo expediente | No comparable | El alias de campo existe en el parser; no se midió contra PostgreSQL. Valores personales/identificadores redactados. | Alta |
| BJC-035 | <code>actor:{valor del corpus redactado}</code> | campo actor | No comparable | El alias de campo existe en el parser; no se midió contra PostgreSQL. Valores personales/identificadores redactados. | Alta |
| BJC-036 | <code>demandado:{valor del corpus redactado}</code> | campo demandado | No comparable | El alias de campo existe en el parser; no se midió contra PostgreSQL. Valores personales/identificadores redactados. | Alta |
| BJC-037 | <code>magistrados:{valor del corpus redactado}</code> | campo magistrados | No comparable | El alias de campo existe en el parser; no se midió contra PostgreSQL. Valores personales/identificadores redactados. | Alta |
| BJC-038 | <code>caratula:{valor del corpus redactado}</code> | campo carátula | No comparable | El alias de campo existe en el parser; no se midió contra PostgreSQL. Valores personales/identificadores redactados. | Alta |
| BJC-039 | <code>sala:A</code> | campo sala moderno | 0; máx. 0 (solo texto libre/resumen) | El alias de campo existe en el parser; no se midió contra PostgreSQL. Valores personales/identificadores redactados. | Media |
| BJC-040 | <code>tipoFallo:L</code> | campo tipo de fallo | Sin filtro equivalente | El alias de campo existe en el parser; no se midió contra PostgreSQL. Valores personales/identificadores redactados. | Media |
| BJC-041 | <code>numeroSentencia:{valor del corpus redactado}</code> | número de sentencia | No comparable | El alias de campo existe en el parser; no se midió contra PostgreSQL. Valores personales/identificadores redactados. | Alta |
| BJC-042 | <code>numeroSumario:{valor del corpus redactado}</code> | número de sumario | No comparable | El alias de campo existe en el parser; no se midió contra PostgreSQL. Valores personales/identificadores redactados. | Alta |
| BJC-043 | <code>1113</code> | referencia normativa | 599; máx. 300 (solo texto libre/resumen) | Paridad estimada: Parcial | Alta |
| BJC-044 | <code>Peña</code> | ñ en nombres de corpus | 61; máx. 61 | NFD elimina diacríticos, por lo que ñ y n se colapsan; el legacy las mantiene distintas. | Alta |
| BJC-045 | <code>Pena</code> | n frente a ñ | 108; máx. 108 | NFD elimina diacríticos, por lo que ñ y n se colapsan; el legacy las mantiene distintas. | Alta |
| BJC-046 | <code>prescripción</code> | acento en í | 1,107; máx. 300 | Paridad estimada: No | Alta |
| BJC-047 | <code>prescripcion</code> | forma sin acento | 1,107; máx. 300 | Paridad estimada: Parcial | Media |
| BJC-048 | <code>zzzxqv</code> | sin resultados | 0; máx. 0 | Paridad estimada: Sí | Baja |
| BJC-049 | <code>daño + responsabilidad</code> | consulta amplia | 6,250; máx. 300 | Paridad estimada: No | Alta |
| BJC-050 | <code>* daño</code> | error sintáctico inicial | Error de sintaxis legacy | Paridad estimada: No | Media |
| BJC-051 | <code>daño +</code> | error sintáctico final | Error de sintaxis legacy | Paridad estimada: No | Media |
| BJC-052 | <code>daño * moral * accidente * contrato * salud * amparo * consumo</code> | más de seis términos | Error de sintaxis legacy | Paridad estimada: No | Media |
| BJC-053 | <code>(daño OR moral)</code> | paréntesis/precedencia | Error de sintaxis legacy | Parentheses are stripped as punctuation; no AST grouping or nested precedence is implemented. | Alta |
| BJC-054 | <code>daño + moral * accidente</code> | OR tiene menor precedencia que AND: daño OR (moral AND accidente). | 2,729; máx. 300 | Modern q parser has separate operator parameter and does not map this symbolic precedence to an AST. | Alta |
| BJC-055 | <code>daño OR (moral AND accidente)</code> | OR agrupa una rama AND; paréntesis deben controlar el AST. | Error de sintaxis legacy | Parser elimina paréntesis y crea broadTerms con todos los términos; el servicio candidato usa query.operador separado (AND por defecto), por lo que la forma exacta no está garantizada. | Alta |

Los IDs top-5 por fecha de las búsquedas no sensibles están en benchmark-busqueda.json. Los campos con valores redactados no se ejecutaron y requieren una consulta de prueba aprobada. La base local de PostgreSQL y sus relaciones PDF no estaban disponibles.

## Comparaciones cuantitativas legacy

| Consultas | A | B | Intersección | Unión | Observación |
|---|---:|---:|---:|---:|---|
| daño / moral | 2,708 | 1,294 | 995 | 3,007 | AND legacy coincide con intersección; OR legacy coincide con unión. |
| daño / dano | 2,708 | 1 | 1 | 2,708 | Legacy distingue ñ y n en esta muestra. |
| Peña / Pena | 61 | 108 | 0 | 169 | Solo agregado; no se guardan nombres, IDs ni resultados personales. |
| prescripción / prescripcion | 1,107 | 1,107 | 1,107 | 1,107 | En este snapshot coinciden los resultados; no se observa efecto del defecto de mapeo de í en este par. |
| accidente / accident% | 3,155 | 3,269 | 3,155 | 3,269 | El prefijo wildcard añade 114 filas a la búsqueda exacta. |

## Hallazgos del benchmark

- En la copia SQLite que usa el endpoint, daño * moral coincide con la intersección: 995 filas. daño + moral coincide con la unión: 3.007. daño - moral devuelve 1.713. La semántica de los símbolos cambia materialmente el conjunto.
- accident% añade 114 filas respecto de accidente; %accident no devuelve filas en este snapshot. El wildcard por prefijo/sufijo exige un contrato explícito y filtros SQL parametrizados.
- El legacy distingue daño (2.708 filas) de dano (1; una fila coincidente). Peña (61) y Pena (108) tampoco comparten filas en este snapshot. La normalización moderna elimina el diacrítico de ñ y puede colapsar esos términos; esto es un riesgo de precisión jurídica y de nombres propios.
- prescripción y prescripcion devuelven las mismas 1.107 filas en esta base. El defecto de mapeo de í visible en PHP no produce divergencia en este par del snapshot.
- El legacy devuelve 25.003 coincidencias para de y 21.655 para a; el parser moderno elimina stopwords y términos alfabéticos menores de tres caracteres.
- La consulta legacy daño + moral * accidente devuelve 2.729 filas: SQLite aplica AND antes que OR, es decir, daño OR (moral AND accidente). El parser moderno no convierte paréntesis a grupos AST.
- El parser moderno reconoce OR y guarda orGroups, pero el API también recibe operador AND/OR por separado y su UI lo inicializa en AND. El filtrado de candidatos usa ese parámetro en broadTerms; escribir OR en q por sí solo puede no producir una unión. Requiere corrección o una comprobación de ejecución antes de prometer OR textual.
- No hubo comparación de cantidades, solapamientos ni top IDs contra PostgreSQL moderno, ni medición de latencia/recall. Esos resultados requieren una DB no productiva levantada con procedencia verificada o un dump de staging autorizado.
