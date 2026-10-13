# Late Hydration — Sprint 12.2

**Fecha:** 2026-10-08 · **Estado:** IMPLEMENTADO EN DEV; reduce el trabajo por página de los adapters. El endpoint legacy conserva un camino costoso; gate NOT READY, docs 112 y 116.

## Corpus

`CorpusSearchSourceAdapter` materializa IDs y claves de orden dentro de `candidateWindow`, limita esa ventana a `pageSize + 1`, deriva `hasMore` de ese conjunto acotado y aplica `LIMIT pageSize` en `pagedCandidates`. Sólo después une `CorpusDocument`, extracción, archivo, provenance, links, Digesto y página coincidente.

La página coincidente se consulta correlacionada con los IDs hidratados; no se recorre `CorpusDocumentPage` por todos los candidatos. El conteo exacto se difiere por defecto.

## Jurisprudencia

`BusquedaService.performSearch()` primero obtiene IDs candidatos; el query con includes recibe sólo un overfetch controlado, limitado por `SEARCH_CANDIDATE_MAX_OVERFETCH`. El score y el orden se calculan con el scorer existente sobre ese conjunto y la paginación comunica `totalExact`/`hasMore`.

## Evidencia y riesgo

Las pruebas de unidad inspeccionan el orden de las cláusulas y la ruta de readiness. El smoke de migraciones inserta un documento Corpus, verifica el trigger y consulta término/frase en schema aislado. Los benchmarks reales documentan filas, tiempos y errores en doc 112.

La igualdad de ranking respecto del universo completo se evalúa aparte; un límite de candidatos no se considera prueba de paridad. No declarar readiness técnica si el ranking, IDs o concurrencia no pasan sus gates.
