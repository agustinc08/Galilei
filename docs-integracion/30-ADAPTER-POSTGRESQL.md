# Adapter de búsqueda PostgreSQL

**Misión:** 5.3 · **Estado:** IMPLEMENTADO como adapter experimental DEV; no conectado aún a endpoints productivos.

## Contrato

`PostgresJurisprudenciaSearchAdapter` implementa `SearchSourceAdapter` y consume el mismo `SearchQueryAst` que `LegacySqliteSearchAdapter`. No hay parser PostgreSQL separado. AST soportado: TERM, PHRASE, AND, OR, NOT, campos permitidos y modos contains/prefix/suffix.

Los campos se traducen mediante whitelist interna. Los términos y filtros viajan como parámetros PostgreSQL. La visibilidad/publicación y los filtros se aplican antes del total, ranking y ventana paginada. La consulta limita página a 300 y tiene orden estable. Cierra el pool con `close()`.

## Normalización y ranking de desarrollo

- Texto normalizado compartido: tolera acentos vocálicos y conserva `ñ` distinta de `n`; no usa `unaccent`.
- Ranking explicable devuelto en `score` y `scoreComponents`: identificador exacto, frase exacta, campo exacto, coincidencia textual y componente trigram.
- `matchedFields`, snippet breve y procedencia legacy se devuelven como metadatos del resultado; no se expone SQL.
- La búsqueda legacy de referencia usa el resumen original sin reescritura para conservar las fronteras de tokens y permitir comparación exacta.

## Guard de entorno

`scripts/with-dev-db-guard.cjs` exige URL PostgreSQL, usuario `bjc_dev`, host literal `127.0.0.1`, puerto `55432` y base `buscador_juridico_civil_dev`. `create-prisma-client.ts` agrega la misma protección en todo runtime no productivo. Nest prioriza `.env.development.local`; el archivo permanece ignorado por Git y con ACL local. El adapter también rechaza destinos distintos.

La política `published-active-only` no devuelve filas del fixture porque las sentencias importadas quedan sin publicar. La suite lo verifica. La conexión al endpoint de búsqueda vigente queda pendiente de validación de producto y autorización editorial.

## Código y pruebas

- Contrato: `JurisprudenciaN/back/src/busqueda/adapters/search-source.adapter.ts`.
- Implementación: `JurisprudenciaN/back/src/busqueda/adapters/postgres-jurisprudencia-search.adapter.ts`.
- Integración real PostgreSQL: `JurisprudenciaN/back/src/busqueda/adapters/postgres-jurisprudencia-search.adapter.spec.ts`.
- Guard de URL Prisma: `JurisprudenciaN/back/src/prisma/create-prisma-client.spec.ts`.
