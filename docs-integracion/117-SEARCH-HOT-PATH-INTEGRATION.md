# 117 — Integración del hot path Search V2

**Corte:** 2026-10-08 · **Destino probado:** PostgreSQL 16.15 DEV loopback.

## Ruta real

```text
BusquedaAvanzadaPage.load()
  → api.get('/busqueda/avanzada', query)
  → BusquedaController.avanzada()
  → supportsV2AdvancedQuery()
  → BusquedaService.federatedSearch()
  → FederatedSearchService.search(AST, contexto)
      ├─ PostgresJurisprudenciaSearchAdapter.search()
      └─ CorpusSearchSourceAdapter.search()
  → merge/ranking estable → DTO compatible `data` + `federated`
```

Frontend: `JurisprudenciaN/front/src/app/(admin)/busqueda-avanzada/page.tsx`, `src/lib/api.ts`. Backend: `JurisprudenciaN/back/src/busqueda/busqueda.controller.ts`, `busqueda.service.ts`, `federated-search.service.ts`. Ambos adapters usan `SearchQueryAst` producido por `search-parser.ts`.

Para las familias cubiertas, el controller no inicia `BusquedaService.avanzada()`; registra el evento con `trackAdvancedV2()` y retorna la página federada convertida al contrato que consume la UI. El perfil DEV confirmó `engine=v2`, `enginesBySource={JURISPRUDENCIA:v2,CORPUS:v2}` y `legacyMs=0` en las 15 familias del benchmark. La UI normal no recibe el objeto `performance`.

Jurisprudencia arma CTEs de candidatos por literal sobre `Sumario`/`Sentencia`, combina ramas booleanas con `INTERSECT`, `UNION` y `EXCEPT`, cuenta/hidrata la página y conserva el score/shape esperado. Corpus consulta candidatos en `CorpusSearchToken`/`CorpusDocument`, limita la página, y luego une extracción, archivo, procedencia, taxonomía y páginas coincidentes. No ejecuta el conteo completo de Corpus para cada término.

## Compatibilidad

| Familia | Legacy | V2 | Hybrid | Hot path anterior | Hot path final |
|---|---|---|---|---|---|
| TERM / ZERO | Sí | Sí | Sólo filtros no cubiertos | Legacy + V2 federado | V2; zero termina rápido |
| PHRASE | Sí | Sí | Sólo campo UI separado no soportado | Legacy + V2 federado | V2; candidato + verificación exacta |
| AND / OR / NOT | Sí | Sí | Sólo filtros no cubiertos | Legacy + V2 federado | V2 set operations |
| FIELD | Sí | Sí para gramática AST | Sí para filtro estructurado no soportado | Legacy + V2 federado | V2 `tema:` medido; filtros UI restantes hybrid |
| PREFIX / SUFFIX / SHORT | Sí | Sí | Sólo filtros no cubiertos | Legacy + V2 federado | V2 tokenizado |
| IDENTIFIER exacto | Sí | Sí para literal/campo AST | Sí para ciertos filtros estructurados | Legacy + V2 federado | V2 cuando se expresa como consulta AST |
| Filtros avanzados no cubiertos | Sí | Parcial | Sí, como reserva explícita | Legacy + V2 federado | Hybrid únicamente en capacidades faltantes |
| Colección/tema/etiqueta Digesto | — | Sí, Corpus | No | V2 Corpus-only | V2 Corpus-only |

La reserva `hybrid` protege el contrato de filtros estructurados como actor, demandado, número de sumario, flags PDF/publicación, frase exacta separada y orden legacy. No es la ruta para una consulta estándar.

## Conteo e hidratación

Jurisprudencia conserva conteo exacto en su consulta de fuente y recupera una página limitada. Corpus usa ventana de candidatos `pageSize+1`, luego hidrata las filas de esa ventana con extracción, archivo, procedencia y taxonomía. Para consultas comunes no hace COUNT global caro; informa `hasMore` y `totalExact=false` cuando el total es sólo límite inferior. PHRASE estima si debe ampliar la ventana candidata; un NOT puro puede materializar el universo visible. Zero no hace late hydration. El adapter Corpus registra normalmente dos consultas principales y puede ejecutar otra iteración de ventana en frase; los perfiles registran estrategia y cantidad sin SQL ni texto consultado.

## Comparación de ruta

Benchmark emparejado: servicio `FederatedSearchService` directo frente a `/api/busqueda/avanzada`, mismo primer bloque interno, un warm-up y diez observaciones por familia. TERM común: 115 ms/114 ms p50; PHRASE: 1.551/1.530 ms; PREFIX: 496/485 ms; SUFFIX: 1.018/1.033 ms; SHORT: 1.724/1.719 ms. Cada comparación obtuvo cero errores de fuente; el endpoint reportó `engine=v2`, `legacyMs=0`. Artifact: `_recovery-work/sprint123/performance/path-comparison.json`.

## Retiro de legacy

El executor legacy queda como referencia de compatibilidad/paridad y como fallback limitado a capacidades. No se eliminó código ni se retiraron filtros del producto. Antes de retirar esos fallbacks se necesita equivalencia de filtros estructurados, campos/citas, permisos y ranking, además de aceptación funcional. No se afirma que el SQL fuente V2 carezca de escaneos secuenciales: se eliminó del hot path estándar la llamada al executor legacy lento.

La prueba Playwright adicional buscó `responsabilidad` desde la interfaz LECTOR y observó resultados completos. La búsqueda de colección existente abrió el documento y verificó realce PDF. Artefactos de benchmark y Playwright bajo `_recovery-work/sprint123/`.
