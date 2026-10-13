# 148 — Secretaría de Jurisprudencia CSJN — Sprint 14

## Cobertura publicada

La portada institucional muestra Sumarios 1863–2026, Fallos completos 1994–2026 y Tomos 1863–2026. La portada consultada dice “1 a 348”, mientras que el catálogo oficial paginado muestra “1 a 349”; se toma el catálogo como evidencia de inventario y se registra el desfase como metadata de portada. La búsqueda incluye formularios de texto, voces, expediente y fecha, además de `g-recaptcha-response`.

## Tomos

Se recorrieron cinco páginas por navegación visible. Resultado: **421 enlaces PDF únicos**, correspondientes a **349 números de tomo** con partes cuando existen, del tomo 1 (`1863/1865`) al 349-I (2026). La página HEAD de muestra fue el recurso id 383, asociado por el catálogo a 324-III (2001): HTTP 200, `Content-Type: application/pdf`, sin `Content-Length` anunciado. No se obtuvo cuerpo ni checksum.

El inventario está en `_recovery-work/sprint14/csjn-tomos-discovery.json`, con hash de cada página y URL oficial por entrada. No hay conteo de fallos individuales ni sumarios: el catálogo de tomos no equivale a esos registros y no se automatizaron búsquedas ante el reCAPTCHA.

## Adquisición y clasificación

Enlaces PDF anunciados: 421. Descargados/verificados: 0. La solicitud de guardar un PDF de muestra fue rechazada antes de ejecutarse por la política del ejecutor. No se inventó tamaño total ni se procesó un tomo completo como sentencia o materia Civil. Estado: `PARTIAL`; pendiente de un mecanismo de adquisición ejecutable autorizado y granularidad por fallo para indexación individual.
