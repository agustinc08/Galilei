# Boolean Candidate Executor — Sprint 12.2

**Fecha:** 2026-10-08 · **Estado:** IMPLEMENTADO EN DEV; compatibilidad 40/40 y extendida 11/11 PASS; ver doc 111.

## Operaciones

Cada literal produce un conjunto mínimo de IDs. Los filtros de visibilidad y estado INDEXED se aplican en la generación de candidatos y vuelven a aplicarse al seleccionar la página.

| AST | Operación sobre IDs |
|---|---|
| literal | candidatos del provider configurado |
| `A AND B` | `INTERSECT` |
| `A OR B` | `UNION` |
| `A AND NOT B` | `A EXCEPT B` |
| `NOT B` | universo visible menos `B` |
| frase de varias palabras | intersección de tokens, luego verificación exacta contigua |

Corpus tokeniza expresiones de campos específicos por su columna permitida. No se aceptan nombres de columna desde el texto del usuario. Valores, patrones, filtros y visibilidades son parámetros SQL.

## Semántica

Se conserva `*` como AND, `+` como OR, `-` como NOT, comillas como frase y `%term`/`term%` como sufijo/prefijo. La normalización conserva `ñ`, quita tildes vocálicas, mantiene números y no elimina `de`/`a` como stopwords.

Las operaciones producen conjuntos exactos o superset con verificación exacta explícita antes de exponer resultados. Un literal negado nunca habilita acceso a filas que no pertenecen al universo autorizado.

## Diagnóstico

El antiguo ejecutor `predicate-v1` sigue disponible para pruebas diagnósticas. La aplicación no atiende duplicando simultáneamente ambos caminos. Para evidencia de planes consultar `sprint122-explain.ts` y doc 112.
