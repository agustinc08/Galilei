# 155 — Adquisición de fuentes — Sprint 14

## Resultado medido

| Medida | Resultado |
|---|---:|
| Enlaces oficiales de tomo en cola | 421 |
| HEAD de muestra | 1 — HTTP 200, `application/pdf`, sin longitud informada |
| Descargas completas | 0 |
| PDFs validados por magic/EOF | 0 |
| SHA-256 de archivos descargados | 0 |
| Bytes adquiridos | 0 |
| Fallos HTTP de adquisición | 0 |
| Pendientes por restricción/ejecutor | 421 tomos; CIJ/TFN/API con alcance desconocido |

El intento de guardar el PDF de muestra fue rechazado por la política del ejecutor antes de ejecutarse; no creó archivo parcial. Se registró como `BLOCKED_EXECUTOR_POLICY`, no como error del servidor. El HEAD confirma el tipo declarado, pero no acredita la descarga completa.

El `robots.txt` de Secretaría devolvió HTML de portada, sin reglas de crawl legibles; eso no se interpreta como autorización masiva. CIJ/TFN disallow permanecen sin solicitudes. C: reportó 150.530.625.536 bytes libres; tamaño total esperado desconocido porque el servidor no anunció `Content-Length`. No hubo descarga masiva ni PDFs en el árbol de código.
