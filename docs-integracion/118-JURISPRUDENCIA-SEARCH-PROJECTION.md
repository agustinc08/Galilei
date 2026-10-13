# 118 — Read model de búsqueda Jurisprudencia

**Decisión Sprint 12.3:** no crear una proyección física nueva para Jurisprudencia.

## Fuente y ejecución

`PostgresJurisprudenciaSearchAdapter` usa las tablas fuente existentes `Sumario` y `Sentencia`. Para cada literal genera conjuntos visibles y activos, combina nodos AST mediante operadores SQL de conjunto y recupera la página solicitada. La SQL permanece parametrizada y la política de publicación/actividad se aplica antes de resultados.

| Propiedad | Estado |
|---|---|
| Filas fuente fixture | 21.109 sentencias / 25.138 sumarios; un sumario huérfano excluido del fixture de búsqueda |
| Tabla/índice V2 nuevo | No creado |
| Build / verify / repair de proyección | No aplica; no hay read model Jurisprudencia independiente |
| Actualización incremental | Se lee la fuente vigente; no se mantiene una copia que pueda quedar stale |
| Paridad SQL SQLite/PostgreSQL | 40/40 PASS_COMPAT, sin diferencias de IDs/orden reportadas |
| Mediana TERM común endpoint | 118,60 ms; p95 234,30 ms |
| Projection readiness | Aplica a Corpus únicamente; 11.008 documentos, 9.475.712 tokens, 0 stale |

La latencia medida no justificó añadir otra copia/indexación de datos. La política de proyección, sus índices y el runbook actual se refieren a Corpus (`CorpusSearchToken`), descrito en docs 108, 114 y 119. No se declara eliminado todo `Seq Scan` del plan relacional; la afirmación comprobada es que una consulta estándar del endpoint no invoca el executor legacy de búsqueda.

## Operación

No hay migración nueva en Sprint 12.3. DEV conserva 20/20 migraciones aplicadas y status limpio. Los artefactos de paridad y benchmark no guardan consultas literales. Los filtros estructurados que el adapter no representa permanecen en fallback híbrido, documentado en doc 117.
