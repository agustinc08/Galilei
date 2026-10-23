# Search Architecture V2 — Sprint 12.2

**Fecha:** 2026-10-08 · **Estado:** IMPLEMENTADO EN DEV; paridad PASS; gate técnico **NOT READY** por latencia/concurrencia end-to-end. Ver docs 111–116.

## Flujo

```text
SearchParser / SearchAst
        ↓
SearchPlanner (AST + readiness de proyección)
        ↓
CandidateProvider (IDs mínimos)
        ↓
BooleanCandidateExecutor (INTERSECT / UNION / EXCEPT)
        ↓
CandidateWindow (filtros, orden, límite + 1)
        ↓
Late hydration de la página
        ↓
Match page / snippet / procedencia
```

La API mantiene el parser y la normalización compartidos. PostgreSQL Jurisprudencia construye conjuntos de IDs por literal y aplica operaciones de conjuntos. Corpus usa `CorpusSearchToken` cuando el control de proyección está listo; durante el backfill o si falta el control, usa el predicado exacto sobre `CorpusDocument.searchText`.

## Componentes existentes

| Responsabilidad | Implementación |
|---|---|
| AST y sintaxis | `src/busqueda/utils/search-parser.ts`, `search-ast.ts` |
| candidatos booleanos Jurisprudencia | `PostgresJurisprudenciaSearchAdapter.buildBooleanCandidateCte()` |
| candidatos booleanos Corpus | `CorpusSearchSourceAdapter.buildBooleanCandidateCte()` |
| proyección Corpus | `CorpusSearchToken`, trigger SQL y `sprint122-search-projection.ts` |
| filtros ACL | restricciones de visibilidad dentro del CTE de candidatos y del query final |
| ranking/detalle Jurisprudencia | `BusquedaService.performSearch()` y su scorer existente |
| hydration Corpus | query final sobre `pagedCandidates` solamente |
| total diferido | `SearchResultPage.totalExact` y `hasMore`, agregados por `FederatedSearchService` |

No se crea una segunda fuente jurídica. El texto de origen sigue en las entidades actuales. La proyección contiene tokens normalizados y estado de consistencia, sin PDF, página, clasificación o provenance.

## Estrategias

- Los términos genéricos Corpus sin espacios buscan subcadenas dentro de tokens normalizados; eso es equivalente a una subcadena sin espacios en `searchText`.
- Las frases de varias palabras intersectan candidatos por token y verifican la frase contigua contra `searchText` antes de paginar.
- `AND`, `OR` y `NOT` operan sobre IDs visibles. `NOT` puro usa el universo visible/indexado.
- Los campos Corpus que no están garantizados en `searchText` conservan su predicado específico sobre la entidad.
- Prefijo y sufijo usan la proyección como conjunto superset y verifican el patrón completo en `searchText`.
- No se usa FTS porque no preserva por sí solo todas las coincidencias de subcadena, palabras cortas y puntuación del contrato vigente.

## Límites

El total de una búsqueda textual puede ser una cota inferior. La respuesta informa `totalExact=false` y `hasMore`; el frontend muestra el indicador aproximado y limita el botón siguiente con `hasMore`. Cada fuente fallida produce `partial=true` y un aviso visible.

Los benchmarks y el gate consolidado están en docs 111–116. Todo resultado medido pertenece a PostgreSQL DEV local; no acredita capacidad institucional o productiva.
