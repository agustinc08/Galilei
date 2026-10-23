# 132 — Rendimiento en preproducción

**Estado:** benchmark de topología preprod **NO EJECUTADO**; no existe destino separado confirmado. No presentar cifras DEV como resultado preprod.

## Referencia DEV Sprint 12.3

Endpoint estándar sobre `bjc_dev@127.0.0.1:55432/buscador_juridico_civil_dev`; diez observaciones más warm-up, carga in-process sin TLS/proxy/red institucional. p50/p95 ms:

| Caso | DEV p50/p95 | Estado |
|---|---:|---|
| TERM común | 119 / 234 | Referencia |
| ZERO | 16 / 19 | Referencia |
| PHRASE | 1.400 / 1.459 | Referencia |
| PREFIX | 456 / 577 | Referencia |
| SUFFIX | 965 / 1.169 | Referencia |
| SHORT | 1.718 / 1.899 | Referencia |
| FIELD | 1.698 / 2.115 | Referencia; sobre objetivo orientativo previo, SLO institucional pendiente |
| AND | 732 / 800 | Referencia |
| OR | 1.174 / 1.227 | Referencia |
| NOT | 820–1.003 / 1.078–1.134 | Referencia; dos formas históricas |
| COMPLEX | 1.787 / 1.875 | Referencia |

Concurrencia DEV 1/5/10/20: Search p95 259/1.331/2.619/4.284 ms, cero errores HTTP/fuente, cola Prisma pico 123 a 20. Harness in-process local, sin red/TLS/proxy. Evidencia completa: docs 120–122; no repetir sin cambio de código, corpus o entorno.

## Plan cuando exista preprod autorizado

Usar mismo build identificable, mismos casos TERM, ZERO, PHRASE, PREFIX, SUFFIX, SHORT, FIELD, AND, OR, NOT y COMPLEX, consultas inocuas acordadas y corpus equivalente aprobado. Registrar p50/p95, errores HTTP/fuente, timeout, cola de pools, recursos y estado del corpus; nunca guardar el texto de consultas sensibles. Carga de 1/5/10 sólo con aprobación de IT y toleración del host; 20 requiere autorización específica. Acordar SLO y umbral de regresión con institución antes de calificar. Comparar topologías con diferencias explícitas, no exigir mismos milisegundos.
