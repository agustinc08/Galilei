# 54 — Ingesta masiva del corpus institucional real

**Fecha:** 2026-10-07. **Destino exclusivo:** PostgreSQL 16 DEV en `127.0.0.1:55432/buscador_juridico_civil_dev`, rol `bjc_dev`. **Inventory scan:** `1a063011-f3a3-421f-bd11-1ecdf3896bb2`; manifest SHA-256 `4e0f484a1603e5d73787982f630af5006c3906a94323b17e5fa619f162ac0224`.

## Pipeline y resguardo

El importador consume el manifest validado, verifica el SHA-256 de cada archivo primario por grupo de contenido y vuelve a resolver las rutas dentro de roots configurados como `readOnly`. Persiste documento, evento de ingesta, archivo content-addressed, páginas, texto indexable, ubicaciones físicas y asociaciones sugeridas en lotes; no crea Sentencias. Las 23.829 ubicaciones físicas quedaron representadas sobre 10.732 documentos/blobs únicos. Los originales se usaron sólo como fuente de lectura.

Se creó backup lógico antes de la ingesta. Al finalizar la migración de índice de búsqueda se guardó otro backup:

| Backup | Bytes | SHA-256 |
|---|---:|---|
| `C:\proyecto triple\_recovery-work\sprint8\backups\buscador_juridico_civil_dev-pre-sprint8-2026-10-07T21-13-56-059Z.dump` | 18.342.798 | `50e3e7ea75101294927ff7816f3dfa54c9391714a26ba1414d88d8084cf9fd43` |
| `C:\proyecto triple\_recovery-work\sprint8\backups\buscador_juridico_civil_dev-pre-sprint8-2026-10-07T22-31-14-193Z.dump` | 220.752.700 | `1952184d7a8223071048e170f0b05cc84178a95e20f4d8579aef323a2842f329` |

Los dumps son DEV y no contienen la contraseña de conexión documentada.

## Escalado, checkpoint y reanudación

Se validaron los gates deterministas 100 → 1.000 → 5.000 → 10.732 hashes únicos. La pasada de 1.000 incorporó 998 documentos nuevos, creó 8.825 páginas, indexó 959 documentos y marcó 39 para OCR; dos fallas de texto se atribuyeron a bytes NUL del extractor. La sanitización Unicode/NUL se corrigió antes de continuar y se reintentaron los elementos. En el gate de 5.000 se detectaron dos items persistidos como `STORED` tras una interrupción; se reparó el `resume` para reextraerlos sin sumar dos veces documentos/bytes y la corrida completa cerró sin filas incompletas.

Una interrupción dejó el agregado del run atrasado respecto de filas de auditoría ya confirmadas (lote de 100). La reconciliación por `itemKey`/hash mostró cero faltantes y corrigió los contadores a partir de items terminales; no se borró ni reinició la base. El importador ahora considera `STORED` incompleto reintentable, preserva conteos ya contabilizados y registra tiempos del extractor por separado de pausas/reanudaciones.

## Corridas

| Pase | RunId | Procesados | Nuevos | Reutilizados | Fallidos | Estado |
|---|---|---:|---:|---:|---:|---|
| Ingesta completa | `5a3ececa-3a55-4a08-bd20-bb43ce3e006d` | 10.732 | 10.727 | 5 | 0 | SUCCESS |
| Segunda pasada de idempotencia | `90f64ee1-2dac-44b1-b3dc-59df4368a287` | 10.732 | 0 | 10.732 | 0 | SUCCESS |

La segunda pasada verificó de nuevo los bytes de los archivos primarios. Ambos pases reportaron 10.332 `INDEXED`, 399 `OCR_REQUIRED`, 1 `INVALID_PDF`, 95.392 páginas y 193.289.260 caracteres. Tras el segundo pase la base mantuvo 10.732 documentos, 10.732 archivos, 10.732 eventos de ingesta, 23.829 ubicaciones y 95.392 páginas; storage siguió en 10.732 objetos (2.115.402.746 bytes). No hubo duplicación de documentos, blobs, extracciones ni páginas.

## Tiempos medidos

- Primera ingesta: `elapsedMs=2.743.789` desde inicio a cierre (45 min 43,8 s); throughput operativo informado por el run: 381,38 archivos/min y 71,69 MiB/min. El throughput excluye duraciones no atribuibles a procesamiento según el agregado de items.
- Extractor: muestra de 9.730 duraciones; p50 49 ms, p95 360 ms.
- Segunda pasada: 305.701 ms (5 min 5,7 s), 3.363,67 hashes/min; no ejecutó extracciones (`extractionDuration.count=0`).
- Tamaño DEV observado tras el corpus y verificaciones: 1.043.627.031 bytes. A 5.000 items se habían observado 735.886.359 bytes; la diferencia de 307.740.672 bytes incluye los documentos restantes, clasificaciones, migración/índice y las pruebas posteriores, por lo que no es una medición aislada del coste de extracción.

## Comandos operativos

`corpus:institutional:scan`, `corpus:institutional:dry-run`, `corpus:institutional:ingest`, `corpus:institutional:resume`, `corpus:institutional:status`, `corpus:institutional:classify`; las escrituras pasan por `scripts/with-dev-db-guard.cjs`. El manifest se reutiliza; no se repitió el scan completo después de ingestar.
