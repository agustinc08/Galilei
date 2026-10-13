# 146 — Mapa oficial de fuentes — Sprint 14

**Fecha de verificación:** 2026-10-08. Los estados describen este discovery; no certifican cobertura total.

| Fuente | Cobertura publicada / conocida | Discovery ejecutado | Descarga | Restricción / resultado |
|---|---|---|---|---|
| Secretaría de Jurisprudencia CSJN | Sumarios 1863–2026; fallos completos 1994–2026; catálogo 1–349 | 5 páginas: 421 enlaces únicos de tomos, 349 números de tomo | 0 bajados | El buscador de fallos incluye campo reCAPTCHA. `robots.txt` de `sjservicios` devolvió HTML de portada, no reglas legibles. Un HEAD de PDF respondió `application/pdf`; el ejecutor rechazó la descarga antes de crear archivo. |
| CIJ histórico | Rango no determinado | Sitemap declarado en robots: 873 URLs; todas apuntan al host `cij7.test:8081` | 0 | `/sentencias.html`, `/d/`, `/scp/d/` y directorios de adjuntos están disallow. No se resolvió el host interno ni se consultaron rutas bloqueadas. |
| Tribunales Federales y Nacionales | M7 documentó búsqueda desde 2013-08-21 y primera instancia desde 2025 | No se reabrió la ruta disallow | 0 | Robots CSJN disallow `/tribunales-federales-nacionales/inicio.html` y sus rutas PDF. No se usó otro host ni endpoint. |
| Datos Abiertos CSJN | 307 datasets visibles al momento de consulta | Búsqueda pública: `fallos`, `sentencias`, `jurisprudencia`, `sumarios`, `civil`; 0 resultados por término | 0 | Robots disallow `/api/`, `/revision/` y páginas de history; `Crawl-Delay: 10`. No se consultó API ni revisión. |
| Corpus local | Último snapshot maestro: 10.732 documentos; 10.752 objetos/archivos; 23.829 ubicaciones; 95.486 páginas | Se reutilizó el estado documentado; no se reescaneó el corpus | 0 nuevos | Roots originales siguen read-only. No hubo escritura en DB. |

Los manifiestos están en `_recovery-work/sprint14/`: `csjn-tomos-discovery.json`, `cij-sitemap-discovery.json` y `open-data-discovery.json`. Contienen metadatos/URLs públicos, no PDFs ni datos institucionales privados.

**Estado:** discovery `PASS WITH GAPS`; adquisición `BLOCKED`; reconciliación `PARTIAL`; ingesta `BLOCKED`; sync incremental `BLOCKED`. Docs 148–158 detallan fuentes y fases.
