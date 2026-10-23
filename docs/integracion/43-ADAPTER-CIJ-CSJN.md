# 43 — Adapter CIJ / CSJN

**Estado:** NO IMPLEMENTADO en Misión 7. El canal de descarga identificado está explícitamente excluido por el `robots.txt` oficial; no se implementa un cliente que lo atraviese.

## Decisión de arquitectura

El pipeline M6 permanece como está. Su contrato `DocumentSourceAdapter.discover(): Promise<DiscoveredDocument[]>` exige ya disponer del `Buffer`, así que no soporta por sí solo el requisito M7 de separar discovery y descarga. No se amplió ese contrato ni se agregó una implementación remota a medias, porque no hay una ruta de adquisición autorizada que permita completar y probar el flujo.

La UI CSJN observada ofrece búsqueda HTML con formulario POST y enlaces de descarga/ver fallo. No se identificó ni validó una API oficial documentada, export útil, endpoint JSON público estable, parámetros de cursor, ETag o contrato de reanudación. La API CKAN consultada no encontró datasets de fallos por los tres términos probados.

## Requisitos para retomar

Una vez habilitado formalmente un canal de descarga:

1. Introducir un contrato remoto separado, con `discoverRecords(filters, cursor)` y `fetchFile(record)`, dejando `DocumentSourceAdapter` local/manual intacto hasta decidir compatibilidad.
2. Delimitar Civil usando códigos/valores oficiales de jurisdicción, cámara, tipo de oficina y tribunal; no usar match textual amplio.
3. Enforce `--dry-run` por defecto, `--limit` obligatorio con máximo 100 para el piloto, `--from`, `--to`, filtro de instancia y checkpoint/resume sólo si la fuente ofrece cursor estable.
4. Concurrencia 1 y una demora conservadora configurable como valor inicial; identificar el User-Agent como desarrollo BJC. Reintentos limitados con backoff sólo para timeout, reset, 429 y 5xx; respetar `Retry-After`. No reintentar CAPTCHA ni respuestas 4xx persistentes.
5. Aceptar sólo hosts oficiales permitidos y PDFs con status 200, content-type compatible, tamaño positivo y cabecera `%PDF-`; limitar bytes y verificar SHA-256.
6. Preservar URLs de detalle/archivo, ID UUID candidato, `metadataOriginal`, fecha de obtención y cabeceras de cache si están presentes. Guardar DEV con visibilidad explícita `INTERNAL`.
7. Ingerir mediante el `CorpusIngestionService` existente, ejecutar idempotencia real y tests mockeados. No escribir PDFs al repositorio.

## Habilitación

Antes de codificar el adaptador de producción de documentos, obtener uno de estos cambios verificables: (a) canal API/export oficial autorizado para descarga; (b) autorización institucional explícita que cubra la ruta automatizada pese al `Disallow`; o (c) actualización de la política oficial que permita la ruta. Una URL que responde HTTP 200 no es suficiente.
