# 158 — Resultado integral Sprint 14

**Dictamen total: PARTIAL / BLOCKED FOR ACQUISITION.** Se ejecutó discovery real en superficies públicas permitidas, se preservaron manifests y se implementaron/testearon helpers offline. No se obtuvieron PDFs completos ni sentencias individuales nuevas; por ello no hubo reconciliación por bytes ni ingesta DEV.

| Fase | Estado | Evidencia |
|---|---|---|
| Discovery | `PASS WITH GAPS` | 421 links de tomos/349 números; CIJ sitemap 873 URLs de host interno; catálogo abierto sin resultados; TFN restringido. |
| Adquisición | `BLOCKED` | 0 descargas; el ejecutor rechazó guardar PDF de muestra antes de ejecución. |
| Clasificación Civil | `PARTIAL` | Reglas determinísticas implementadas; 0 fallos individuales procesados. |
| Reconciliación | `PARTIAL` | Métodos y tests; 0 archivos candidatos para comparar con Corpus. |
| Ingesta/indexación | `BLOCKED` | Sin archivos verificados; DB sin cambios. |
| Sync incremental | `BLOCKED` | No existe cursor permitido/verificado para fuentes bloqueadas. |

## Totales sin inferencias

- Jurisprudencia individual nueva incorporada: **0**.
- PDF completo descargado/verificado: **0**; bytes adquiridos: **0**.
- Referencias de archivos recopilatorios CSJN: **421**.
- Fallos Civil confirmados en fuentes externas: **desconocido**.
- Ya en Corpus / SHA duplicados / candidatos jurídicos: **no evaluado** para fuentes Sprint 14.
- Cobertura conocida: tomos 1–349 (1863–2026); fallos completos desde 1994 y sumarios desde 1863 según la UI. Cobertura real de resultados y gaps: desconocida.

El corpus original quedó intacto. No se reauditaron Search, preproducción ni los roots locales. Backend: Prisma generate PASS bajo guard, typecheck PASS, suite general 93 PASS/15 omitidos, build PASS; helpers offline 7/7. Obtener los recursos pendientes requiere una vía de adquisición que permita al ejecutor guardar archivos y, para CIJ/TFN, un canal institucional que resuelva las restricciones. Manifiestos en `_recovery-work/sprint14/`.
