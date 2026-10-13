# 122 — Paridad Search Sprint 12.3

**Resultado final:** 40/40 `PASS_COMPAT`, 0 fallos. Benchmark de SQLite en modo read-only/inmutable frente a PostgreSQL fixture sobre el universo equivalente de IDs legacy; excluye `tb_microisis` y sumario huérfano.

| Diferencia | Casos |
|---|---:|
| Sólo SQLite | 0 |
| Sólo PostgreSQL | 0 |
| Diferencias de orden en primera página | 0 reportadas |
| Casos con timeout/error | 0 |

El artefacto registra conjuntos SHA-256 y muestras acotadas, no texto de consulta. Ruta: `_recovery-work/sprint123/parity/benchmark.json`.

El benchmark V2 mantiene el adaptador legacy-reference para comparación; el endpoint del producto se validó por separado como V2 en doc 120. Esta paridad cubre la matriz de búsqueda Jurisprudencia, no demuestra aceptación de filtros híbridos ni de ACL institucional. La corrección de PHRASE Corpus se cubre con unit/integration tests de Corpus y no cambia el universo de parity de Jurisprudencia.
