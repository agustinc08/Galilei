# 44 — Piloto de ingesta civil real

**Resultado:** NO EJECUTADO. Un visor web previsualizó un PDF durante la inspección inicial del enlace, antes de confirmar robots; no se guardó en el workspace ni se incorporó a Corpus. No hubo escrituras de Corpus en Misión 7.

| Métrica | Resultado |
|---|---:|
| Registros descubiertos para piloto | 0 |
| PDFs guardados e ingeridos en el piloto / tamaño | 0 / no aplica |
| SHA-256 y blobs DEV | 0 |
| IngestionRecords / documentos | 0 / 0 |
| Extracciones / páginas | 0 / 0 |
| OCR_REQUIRED / FAILED | 0 / 0 |
| Primera / segunda instancia ingeridas | 0 / 0 |
| Pruebas Search sobre documentos reales | No ejecutadas |

## Motivo

La ruta oficial observada para los PDFs está bajo `/tribunales-federales-nacionales/d/`, prohibida por `https://www.csjn.gov.ar/robots.txt`. El archivo histórico CIJ `/archivo-cij/adj/pdfs/` también está prohibido. La misión declara NO GO cuando la fuente bloquea la automatización y prohíbe evasiones. La previsualización del visor no se trató como ingestión piloto. No se usó endpoint alternativo, descarga manual para reingreso, proxy ni bypass.

## Regla preparada para el piloto futuro

Cuando exista un canal autorizado: período cerrado documentado; resultados Civil filtrados por catálogo oficial; orden y límite deterministas; `limit <= 100`; intento de cubrir primera y segunda instancia si la fuente las ofrece; manifest local ignorado por Git con IDs, URLs, metadata original, estado HTTP, tipo/tamaño, checksum, extracción, páginas y error. Repetir el mismo manifest debe reutilizar identidad por fuente + ID externo y archivo por SHA-256, sin duplicar páginas/blobs. Visibilidad DEV explícita: `INTERNAL`.

No existe manifest de datos porque no se realizó adquisición. No inventar un piloto exitoso a partir de un resultado que sólo se pudo observar en la web pública.
