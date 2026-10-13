# 149 — CIJ histórico — Sprint 14

## Discovery permitido

El `robots.txt` oficial declara `sitemap.xml` y `news-sitemap.xml`, pero prohíbe `/sentencias.html`, `/d/`, `/scp/d/` y varias rutas de adjuntos PDF. Se consultó únicamente el sitemap declarado. El sitemap tuvo 873 URLs y todas apuntaron a `cij7.test:8081`, un host interno; no se sustituyó el host ni se visitaron esas URLs.

Distribución: 851 rutas `/nota-*`, 20 rutas de navegación/categoría, 1 portada y 1 página informativa. El sitemap no es un inventario de sentencias ni PDFs. Cincuenta y tres slugs contienen términos como “fallo”, “sentencia” o “jurisprudencia”; son títulos de noticias, no fallos clasificados. Las fechas `lastmod` observadas fueron 2022-06-08.

## Resultado

Rango histórico de fallos, total de sentencias, adjuntos y cobertura Civil: **desconocidos**. PDF refs en rutas permitidas: 0. Adquisiciones: 0. Las rutas restringidas quedan pendientes y requieren canal institucional autorizado. El manifest con las 873 URLs está en `_recovery-work/sprint14/cij-sitemap-discovery.json`.
