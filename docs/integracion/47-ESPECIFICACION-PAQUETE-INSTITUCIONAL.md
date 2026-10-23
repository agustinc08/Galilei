# 47 — Especificación de entrega documental institucional

**Misión:** 7.1 · **Fecha:** 2026-10-07 · **Estado:** contrato implementado en DEV, sujeto a piloto institucional.

## Propósito y límites

Recibir una exportación autorizada sin depender de cómo se obtuvo. El receptor acepta una carpeta de paquete; no navega fuentes públicas ni decide que un documento sea jurisprudencia/publicable. El paquete es una afirmación de procedencia del emisor, no una certificación independiente.

Fuentes sin código conocido se registran como `INSTITUTIONAL_IMPORT`. Nunca inferir CIJ, CSJN u órgano emisor a partir del nombre del archivo. La fase 7A de descubrimiento público sigue cerrada en NO GO para descarga automatizada. Esta especificación sólo habilita 7B con entrega institucional autorizada.

## Formato canónico 1.0

Raíz del paquete: `manifest.json` (o CSV soportado por el validador) y archivos relativos. Campos mínimos: `schemaVersion: "1.0"`, `packageId` estable, `source.code`, `source.name`, `source.type`, `generatedAt`, lista `documents`. Cada documento debe declarar `path` y `mimeType`; SHA-256 siempre se calcula localmente y, si se declara, se coteja antes de importar. Son recomendados `externalId` estable, `title`, `documentType`, `jurisdiction`, `court`, `chamber`, `instance`, `caseNumber`, `decisionDate`, `sourceReference`, `sourceUrl`, `visibility` y `metadata`.

```json
{
  "schemaVersion": "1.0",
  "packageId": "ENTREGA-CIVIL-2026-0001",
  "source": { "code": "INSTITUTIONAL_IMPORT", "name": "Export autorizado", "type": "INSTITUTIONAL_IMPORT" },
  "generatedAt": "2026-10-07T12:00:00Z",
  "documents": [{ "path": "files/decision-001.pdf", "sha256": "<64 hex>", "mimeType": "application/pdf", "externalId": "decision-001", "title": "Resolución", "visibility": "INTERNAL" }]
}
```

PDF y TXT están admitidos. Rutas relativas contenidas, archivos regulares, tipo/extensión coherentes, firma PDF, límite actual 100 MB por archivo, SHA-256 calculado, ID externo duplicado y duplicados SHA se informan antes de importar. Rechazar traversal, symlinks, archivos ausentes, checksum discordante o formato no soportado. Duplicados binarios no fusionan documentos/identidades jurídicas.

CSV UTF-8 (con BOM aceptado) y Windows-1252 con encabezados mapeables se admite junto a los archivos; metadatos no reconocidos se preservan. `draft` escanea explícitamente una carpeta y genera un manifiesto borrador: requiere revisión humana y no activa watcher. ZIP no se ingiere directamente; descomprimirlo fuera de la carpeta de recibos usando un extractor seguro y entregar el árbol resultante.

## Comandos DEV

Desde `C:\proyecto triple\server`: `pnpm corpus:package:draft -- <carpeta>`, `pnpm corpus:package:validate -- <carpeta>`, y para las acciones con DB `node scripts/with-dev-db-guard.cjs corpus-package dry-run <carpeta>` / `... corpus-package import <carpeta> [--receipt-dir <raíz>]`. El guard exige usuario `bjc_dev`, host `127.0.0.1`, puerto `55432` y base `buscador_juridico_civil_dev`. Dry-run lee y reporta sin escribir. Import genera receipt fuera del paquete, particionado por packageId y runId. `status <import-receipt.json>` muestra resumen; `--retry-failed <receipt>` limita reintentos a rutas fallidas.

## Idempotencia y cambios

Con `externalId` estable, un checksum idéntico reutiliza el registro; un binario nuevo para la misma identidad crea versión de archivo sin sobrescribir la anterior. Sin `externalId`, el fallback `package:<packageId>:<path>` requiere conservar packageId y ruta entre entregas. Cada registro captura packageId, hash del manifiesto, ruta relativa y código de fuente en `metadataOriginal`; receipt por ejecución registra éxitos, skips, errores y hashes. El estado del paquete/receipt no se persiste en una tabla de batch: conservar recibos como evidencia externa.
