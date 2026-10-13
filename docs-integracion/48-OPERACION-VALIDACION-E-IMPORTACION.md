# 48 — Operación, validación e importación de paquetes

**Estado:** procedimiento ejecutable sólo contra PostgreSQL DEV local; no ejecuta adquisición externa.

## Secuencia

1. Recibir entrega y autorización por el canal institucional acordado; preservar originales y documentar emisor, fecha, alcance y restricciones fuera de la app.
2. Descomprimir ZIP a carpeta aislada (si aplica), sin rutas absolutas ni traversal, y comprobar que el paquete no comparte destino con recibos/storage.
3. Ejecutar `draft` sólo para crear manifiesto inicial; revisar IDs, metadatos y ACL con responsable de datos.
4. Ejecutar `validate`; resolver todos los errores y revisar warnings de hashes repetidos. No importar manifiestos incompletos.
5. Ejecutar `dry-run` detrás de `with-dev-db-guard.cjs`; revisar new/alreadyKnown/possibleUpdates y bytes.
6. Ejecutar `import` en DEV. Revisar el JSON/Markdown de receipt, su SHA-256, estado por documento, extraction status y errores.
7. Repetir import para comprobar ALREADY_IMPORTED; para errores corregidos, usar `--retry-failed` con el receipt anterior y el mismo packageId/ruta.
8. Comparar conteos y hashes contra el manifiesto del emisor antes de promoción o exposición.

## Semántica

`validate` y `draft` son filesystem-only. `dry-run` es read-only DB. `import` puede escribir y sólo se ejecuta bajo el guard DEV. PDF sin texto recibe `OCR_REQUIRED`, no se inventa texto. El receipt tiene hash canónico sin incluir su propio campo `receiptSha256`; el Markdown es una representación legible, no la fuente verificable. Cada invocación crea un subdirectorio `<receipt-root>/<packageId>/<runId>` para evitar colisión en reintentos.

Los errores de validación cuentan como fallos; un paquete parcial debe corregirse antes de operar. La ruta de retry procesa sólo paths fallidos presentes en el paquete actual. La reimportación exacta no crea versiones ni ingestions adicionales. Una nueva huella para un `externalId` estable sí crea una versión conservando la anterior.

## Barreras

No conectar producción, destinos remotos ni servidores institucionales. No usar paquetes institucionales en tests; pruebas M7.1 usan fixtures sintéticos temporales. Revisar permisos antes de marcar cualquier documento `PUBLIC`. ZIP directo, tamaños configurables, firma/autenticación del emisor, batch persistente y OCR están fuera de la implementación actual.
