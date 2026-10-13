# Adaptador PostgreSQL — contrato y diseño de implementación

## Estado

El adaptador **no está implementado**: la Misión 5.2 requiere validar primero PostgreSQL 16 local en `127.0.0.1:55432`. En esta etapa no se modificó el código, el schema Prisma ni las migraciones.

## Contrato existente

La implementación futura debe satisfacer `SearchSourceAdapter.search(query: SearchQueryAst, context: SearchContext): Promise<SearchResultPage>`. El parser/normalizador existente crea el AST; el adapter lo recibe directamente y no analiza de nuevo `originalQuery`.

Se conservarán la sintaxis y los nodos actuales: TERM, PHRASE, AND, OR, NOT, campo permitido y matchMode `contains`, `prefix` o `suffix`. No se duplicarán gramática, operadores, normalización ni listas de campos. Se respetarán `SearchContext` (visibilidad PUBLIC/INTERNAL/ADMIN, dialecto, política de publicación, sala, fechas y paginación) y la forma de respuesta `total`, `page`, `pageSize`, `results`.

## Traducción SQL segura

- Whitelist interna de campos, relaciones, órdenes y filtros; nunca interpolar un nombre elegido por el usuario.
- Valores siempre enlazados como parámetros Prisma (`$queryRaw`/`Prisma.sql`) o vía ORM; no concatenar texto ingresado a patrones `LIKE`.
- Escapar `%`, `_` y `\\` de términos literales antes de aplicar los comodines controlados por el AST.
- AND/OR/NOT y paréntesis se generan desde nodos tipados del AST; expresión vacía, profundidad y cantidad de términos se limitan según el contrato existente.
- Aplicar publicación/ACL/visibilidad y filtros antes de ranking, fragmentos de texto y total. No exponer SQL en resultados.
- Conteo y página deben compartir filtros y semántica. Añadir un desempate estable por identificador al orden para que la paginación sea determinista.

## Semántica a verificar

Comparar contra el adaptador SQLite en una misma lista de `legacyId` de fixture, separando modo de compatibilidad de modo moderno. Verificar frases, operadores, campos, acentos, `ñ` (distinta de `n`), mayúsculas, palabras cortas, identificadores, paginación y visibilidad. Para prefijos y sufijos, probar escape de patrones y medir planes/costos; no cambiar la semántica del parser.

La migración existente declara columnas normalizadas y GIN `pg_trgm` (ver documento 28). Esto no prueba por sí solo equivalencia del normalizador español ni búsqueda FTS. No activar `unaccent` a ciegas: una transformación que quite `ñ` colapsaría `Peña` con `Pena`. La decisión debe estar respaldada por casos del benchmark y columnas disponibles.

## Persistencia y procedencia

Prisma se usa para entidades, relaciones y filtros simples. SQL PostgreSQL específico sólo se adopta cuando hace falta para trigram/FTS/ranking, siempre parametrizado. Conservar `legacyId` y los campos de procedencia que ya soporte el schema, sin inventar entidades de MicroISIS ni modificar el modelo antes de demostrar necesidad.

## Criterio de aceptación pendiente

1. PostgreSQL 16 local comprobado, usuario de mínimo privilegio y base DEV aislada.
2. Migraciones históricas revisadas y aplicadas a esa base; schema/tablas comprobados.
3. Fixture determinista importada y recuentos/fuentes verificados.
4. Adaptador registrado por inyección de dependencias sin romper el SQLite legacy.
5. Pruebas de integración para cada nodo AST, filtros, ACL, seguridad, ranking y paginación; los 35 tests previos conservan su resultado.
6. Benchmark con igualdad de universo, conteos e IDs registrados; ninguna cifra inventada.
