# 53 — Inventario de PDFs institucionales

**Ejecución:** 2026-10-07. **ScanId:** `1a063011-f3a3-421f-bd11-1ecdf3896bb2`. **Alcance:** raíces locales de Jurisprudencia, sólo lectura. Digesto se mantiene fuera del inventario activo hasta cerrar su crosswalk de ownership/ACL.

## Roots autorizados

| Root | Ruta relativa al workspace | Archivos PDF-like | Bytes |
|---|---|---:|---:|
| `jurisprudencia-back-data` | `JurisprudenciaN/back/data` | 10.639 | 2.102.111.083 |
| `jurisprudencia-back-uploads` | `JurisprudenciaN/back/uploads` | 11.747 | 2.402.132.093 |
| `jurisprudencia-legacy-extracted` | `_legacy-audit-work/extracted/jurisprudencia` | 1.443 | 362.503.495 |
| **Total** | 3 roots activos, read-only | **23.829** | **4.866.746.671** |

`digesto/server/pdfs` contiene 278 PDFs de un dominio separado y quedó registrado como root inactivo; no se ingirió ni se usó para asociación. No se observaron roots activos de PDFs en Copernic o el frontend.

## Métricas del scan completo

- 23.829 archivos con firma PDF; 23.827 nombres `.pdf` y 2 archivos sin extensión que sí tienen firma PDF.
- 10.732 SHA-256 únicos; 13.097 copias físicas duplicadas respecto del conjunto único; tamaño total 4.866.746.671 bytes (4,53 GiB).
- Cero archivos de cero bytes, ilegibles, rutas repetidas o firmas no-PDF con extensión `.pdf`.
- 1.442 nombres repetidos; se conservan las rutas individuales.
- 23.827 archivos muestran cabecera y marcador EOF; 2 muestran cabecera PDF sin marcador EOF. El control es de firma/cabecera/cola, no equivale a parse estructural de cada archivo.
- El scan no modificó, renombró ni movió originales.

## Manifest reproducible

- Ruta fuera de los repositorios fuente: `C:\proyecto triple\_recovery-work\sprint8\inventory\1a063011-f3a3-421f-bd11-1ecdf3896bb2\institutional-pdf-inventory.json`.
- SHA-256: `4e0f484a1603e5d73787982f630af5006c3906a94323b17e5fa619f162ac0224`.
- Incluye timestamp, scanId, roots, paths relativos, tamaño, timestamps de modificación, extensión, mime detectado, SHA-256, firma y totales.
- El manifest y su sidecar permanecen en `_recovery-work`; no se versionan PDFs ni manifests con identificadores de rutas personales.

## Procedencia y alcance

El inventario se obtiene del filesystem local observado, no de descarga pública automatizada. Las rutas CSJN/CIJ disallow conservan NO GO. El siguiente scan puede usar este manifest como base, pero la optimización incremental por journal/file identity y la detección persistida de originales faltantes aún quedan pendientes; no se omite hashing cuando no hay una señal confiable de cambio.
