# Sprint 10 — Crosswalk Digesto local → Corpus

**Estado:** integración documental local parcial; metadata funcional legacy pendiente.

## Evidencia

El scan read-only de `digesto/server/pdfs` contó 278 PDFs físicos (197.541.924 bytes), 276 SHA-256 únicos y 2 duplicados internos. Los 278 son válidos; 264 tienen texto y 14 quedan `OCR_REQUIRED`. No hubo fallos de extracción, SHA coincidentes con Corpus previo ni exports locales JSON/CSV/XML detectables en la raíz inspeccionada.

## Mapeo comprobado

| Fuente local | Corpus compartido | Regla |
|---|---|---|
| Bytes PDF | blob content-addressed | Una copia por SHA; original read-only. |
| Ruta/nombre de archivo | `originalFilename` y procedencia | Se conserva, sin inferir metadata jurídica. |
| SHA-256 | checksum / idempotencia | Identidad física; 2 duplicados internos reutilizan SHA. |
| Texto/páginas extraídos | texto derivado/estado | Se indexan 264; 14 esperan OCR. |
| Origen local | `sourceSystem = DIGESTO_LOCAL` | Visibilidad `INTERNAL`; revisión pendiente. |
| Sin ID/export local | sin `legacyId`/crosswalk | No inventar correspondencias. |
| Sin colecciones/temas/tags exportados | colección marcador “Digesto local — metadatos pendientes” | No es taxonomía importada. |

Import DEV: 276 documentos únicos nuevos; 2 rutas físicas duplicadas reutilizan SHA; 264 indexados y 14 `OCR_REQUIRED`. Corpus previo: cero coincidencias por hash. No se creó segundo repositorio ni migración nueva. No se consultó Digesto remoto.

## Crosswalk semántico

`MIGRAR`: bytes y checksum. `MAPEAR`: origen y estado de extracción a campos existentes. `DERIVAR`: nombre y texto sólo como contenido de búsqueda. `DESCARTAR`: nada, no hubo export con campos disponibles. `PENDIENTE`: IDs legacy, colecciones/temas/tags reales, dependencias, autoría, estado editorial y ACL. Se requiere export local autorizado y revisión de identidad/ACL.

Artefactos: `_recovery-work/sprint10/digesto/local-scan.json` y `import-result.json`. Backup DEV previo: `_recovery-work/sprint10/backups/buscador_juridico_civil_dev-pre-sprint10-2026-10-08T03-57-50-358Z.dump` (220.969.878 bytes; SHA-256 `b5e1bc78b77dcfa9925a62f245811886c40695b7e5e31fe1acaee0577636f8e`). No son datos productivos ni acreditan aceptación institucional.
