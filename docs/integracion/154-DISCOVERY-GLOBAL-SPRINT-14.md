# 154 — Discovery global — Sprint 14

## Ejecución real

| Fuente | Descubiertos | Documentos/PDF refs | Civil | Pendientes |
|---|---:|---:|---:|---|
| CSJN Secretaría — tomos | 421 enlaces únicos; 349 números de tomo | 421 PDFs anunciados; 0 contenidos adquiridos | Tomos mixtos, sin clasificar | 421 descargas pendientes |
| CSJN Secretaría — fallos/sumarios | Conteo desconocido | Conteo desconocido; no se recorrieron resultados | No evaluado | Buscador con reCAPTCHA |
| CIJ | 873 URLs de sitemap; no son un inventario de fallos | 0 sentencias/PDF refs confirmadas | 0 registros procesados | Sitemap con host interno; rutas de fallos disallow |
| TFN | Conteo actual desconocido | 0 | No evaluado | Inicio y PDFs disallow |
| Datos Abiertos | 307 datasets totales | 0 hallazgos en cinco términos; 0 recursos | 0 | API/history disallow; slugs históricos sin verificación actual |

## Alcance temporal conocido

CSJN: catálogo de tomos numéricos 1–349, años 1863–2026. La búsqueda de fallos completos se publica desde 1994 y los sumarios desde 1863, sin cantidad visible. CIJ y TFN no tienen rango actual confirmado en este sprint.

## Manifiestos y decisión

`_recovery-work/sprint14/*-discovery.json` guarda URLs, IDs, hashes de páginas y resultados. Discovery `PASS WITH GAPS`: completado para catálogo de tomos y sitemap permitido; bloqueado para búsquedas y rutas de sentencias restringidas. El siguiente insumo para los gaps exactos es un export institucional CIJ/TFN o un canal autorizado con registros y adjuntos sin CAPTCHA ni robots-disallow.
