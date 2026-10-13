# 151 — Datos Abiertos CSJN — Sprint 14

El portal declaró 307 conjuntos en las páginas consultadas. Se usó la búsqueda visible del catálogo para `fallos`, `sentencias`, `jurisprudencia`, `sumarios` y `civil`, dejando diez segundos entre solicitudes. Las cinco búsquedas terminaron HTTP 200 con “no se encontraron datasets”. Recursos vivos, descargados y registros parseados: 0.

El `robots.txt` declara `Crawl-Delay: 10` y disallow para `/api/`, `/revision/` y páginas de historial. No se consultó CKAN API (`package_search`, `package_show`), revisiones ni endpoints equivalentes. M7 había registrado huellas históricas de paquetes `fallos-2012` a `fallos-2016`; su vigencia y recursos actuales no se confirmaron en esta corrida.

Las consultas y los hashes capturados están en `_recovery-work/sprint14/open-data-discovery.json`. “307 conjuntos totales” no implica 307 datasets de jurisprudencia. Resultado actual: 0 hallazgos por los cinco términos; cobertura histórica abierta sigue desconocida.
