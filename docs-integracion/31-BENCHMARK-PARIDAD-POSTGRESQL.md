# Benchmark de paridad SQLite / PostgreSQL

**Misión:** 5.3 · **Estado:** COMPLETADO · **Fecha:** 2026-10-07

## Método

Se reutilizó `benchmark-busqueda.json` sin modificarlo. Los 40 casos con medición legacy se ejecutaron sobre la SQLite histórica en modo read-only/immutable/query_only y sobre el fixture PostgreSQL importado desde las mismas tablas, con los mismos filtros y IDs de sumario preservados. La relación efectiva en ambos motores es `tb_sumarios INNER JOIN tb_sentencias`; el único sumario huérfano queda fuera en ambos.

La comparación guarda conteos, intersección, diferencias y SHA-256 de conjuntos ordenados de IDs. Los datos legales de los resultados no se copian al reporte. El benchmark completo está en `29-benchmark-postgresql.json`.

## Resultado de compatibilidad

- Casos medidos: **40**.
- `PASS_COMPAT`: **40/40**.
- IDs `sqliteOnly`: **0**.
- IDs `postgresOnly`: **0**.
- Errores de conteo contra los valores históricos: **0**.
- BJC-001 (`daño`): 2.708 en ambos motores y digest de IDs idéntico.

Los siete casos de sintaxis inválida, siete no comparables y un filtro no disponible en la interfaz legacy conservan su clasificación original; no se convirtieron en casos medidos.

## Tiempos de primera página

Calentamiento previo y 3 iteraciones por cada uno de BJC-001, BJC-004, BJC-016 y BJC-047; página de 300 resultados. p50/p95/máximo en milisegundos:

| Consulta | Parser p50/p95/max | SQLite DB p50/p95/max | PostgreSQL legacy DB p50/p95/max | PostgreSQL modern DB p50/p95/max |
|---|---:|---:|---:|---:|
| BJC-001 | 0.052 / 0.101 / 0.101 | 370.772 / 374.079 / 374.079 | 4456.208 / 4493.485 / 4493.485 | 1783.475 / 1795.018 / 1795.018 |
| BJC-004 | 0.053 / 0.062 / 0.062 | 365.885 / 371.223 / 371.223 | 4450.786 / 4482.311 / 4482.311 | 1586.362 / 1594.175 / 1594.175 |
| BJC-016 | 0.030 / 0.031 / 0.031 | 366.379 / 370.135 / 370.135 | 4460.633 / 4542.655 / 4542.655 | 1940.179 / 1940.830 / 1940.830 |
| BJC-047 | 0.034 / 0.039 / 0.039 | 370.295 / 370.402 / 370.402 | 4481.888 / 4497.848 / 4497.848 | 1537.356 / 1595.900 / 1595.900 |

La ruta de compatibilidad legacy y la búsqueda PostgreSQL moderna son más lentas que SQLite en esta máquina. Este resultado es una medición de desarrollo, no una aceptación de performance ni una afirmación de mejora. Antes de conectar el adapter a endpoints o usuarios se requiere la fase de tuning registrada en `BJC-ROADMAP.md`.
