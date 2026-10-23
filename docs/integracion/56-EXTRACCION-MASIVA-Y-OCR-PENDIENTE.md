# 56 — Extracción masiva y backlog OCR

## Cierre de extracción

| Estado terminal del run | Cantidad | Porcentaje de los 10.732 SHA únicos |
|---|---:|---:|
| INDEXED, con texto indexado | 10.332 | 96,27 % |
| OCR_REQUIRED | 399 | 3,72 % |
| INVALID_PDF | 1 | 0,01 % |
| FAILED / incomplete | 0 | 0 % |

Se persistieron **95.392 páginas** y **193.289.260 caracteres**. Los documentos `OCR_REQUIRED` no se presentan como extraídos ni buscables por texto. El PDF inválido se distingue del OCR; no se intentó reparar ni descartar el original. No se ejecutó OCR masivo.

## Motor y tiempos

Se reutilizó `BasicDocumentTextExtractor` y extracción por página. El run persistió extractor, versión, estado, páginas, texto, error y duración; muestra de duración del extractor n=9.730, p50 49 ms y p95 360 ms. Ingesta activa reportada: 381,38 archivos/min; throughput de entrada medido: 71,69 MiB/min. La corrida wall-clock fue 45 min 43,8 s e incluyó reanudaciones/checkpoints; no mezclar el wall-clock con duración de extractor. El segundo pase idempotente tardó 5 min 5,7 s y no volvió a extraer.

En el piloto de 1.000 se detectó que NUL embebidos del extractor causaban rechazo UTF-8/PostgreSQL. Se agregó sanitización antes de persistir texto/páginas, se reintentaron los casos y la corrida completa terminó con cero fallidos. La extracción `STORED` interrumpida también se hizo recuperable sin duplicar contadores.

## Próxima estrategia OCR

Cuantificar primero con un piloto local, reversible y acotado de 399 documentos, estimar calidad y coste, comparar páginas OCR contra originales y someter resultados a revisión. Antes de ese piloto elegir herramienta local y licencia, fijar límites CPU/RAM/tiempo y aplicar mismos controles de ACL/procedencia. No ejecutar OCR remoto ni global como parte de Sprint 8.
