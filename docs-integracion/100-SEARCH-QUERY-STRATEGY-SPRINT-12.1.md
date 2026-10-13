# 100 — Estrategia SQL por nodo (Sprint 12.1)

## Estado implementado y resultado

La semántica del parser y el contrato de búsqueda se mantuvieron. Se eliminó el `sentencia.count()` duplicado de búsquedas de texto: el total legado reportado era el conjunto de candidatos ya limitado y puntuado, por lo que aquel COUNT no aportaba un total exacto útil. Los filtros sin texto conservan el conteo exacto. La paridad del adaptador contra SQLite pasó 40/40.

La ejecución Corpus conserva `ILIKE` sobre `searchText`, usa el GIN trigram existente, calcula COUNT separado del page/ranking y solicita página de resultados. `COUNT` y `PAGE` se ejecutan en paralelo; con el umbral runtime vigente de 4 s (máximo configurable 4,5 s) falló sistemáticamente en parte importante de los casos. No se aumentó el timeout.

| Nodo / familia | Estrategia actual | Evidencia / decisión |
|---|---|---|
| TERM | Prisma `OR` de campos y relaciones; trigram existente no basta | p50 6,26 s común y 6,71 s raro; raíz en doc 99 |
| PHRASE | mismo predicado más verificación/puntuación en Node | p50 7,68 s; sin mejora material |
| AND | ramas AST anidadas en Prisma | p50 10,18 s; p95 12,63 s |
| OR | ramas AST `OR`; sin UNION de IDs | p50 7,05 s; p95 12,31 s |
| NOT | negación Prisma del árbol | NOT con positivo p50 7,98 s; NOT puro 6,85 s |
| PREFIX / SUFFIX | operadores compatibles y trigram cuando aplica | p50 5,97 s / 4,05 s |
| SHORT | contiene literal, preserva coincidencia de subcadena | p50 4,01 s; siete fallas Corpus |
| IDENTIFIER | filtros por identificador existentes | p50 26 ms después, con baseline 15 ms; investigar regresión local pequeña |
| FIELD | filtro por campo en Prisma | p50 865 ms |
| COLLECTION | filtro federado por colección | p50 2,81 s; Corpus registró 5/10 errores |
| ZERO | predicado normal, sin fast path | p50 6,69 s: confirma scan del universo y no es costo de serialización |

El GIN de páginas y el índice de orden experimentales se retiraron tras EXPLAIN; no se conservan índices sin beneficio demostrado. No se cambió a FTS porque alteraría coincidencia literal de subcadenas, acentos/ñ y frases sin un ejecutor híbrido con paridad demostrada. La estrategia de IDs candidatos por rama y la carga de detalle posterior requieren una implementación y benchmark dedicados antes de adoptarse.

**Siguiente decisión técnica:** separar generación de candidatos indexable por AST de la hidratación/puntuación de los 500 resultados; demostrar equivalencia de IDs y ranking por caso antes de reemplazar el ejecutor.
