# Certificación del Corpus Civil actualmente adquirido

**Versión:** Civil Corpus Certification v1  
**Corte:** 2026-10-14  
**Estado:** `CERTIFIED_WITH_KNOWN_GAPS`  
**Snapshot:** `ed23fdab736a5b8dd13c485f941d106f444d3722f2a0c0951a238b88fd7160ab`

> Esta certificación aplica al corpus Civil actualmente adquirido por Galilei. No afirma que el corpus contenga el universo completo de la jurisprudencia Civil.

## Propósito y alcance

J8 revalidó de extremo a extremo los 6.070 documentos Civil presentes en la base DEV al corte. Determina integridad de archivos y procedencia, consistencia de páginas, presencia en Search, preparación de Viewer, interpretación de identidad jurídica y clasificación de gaps. No es auditoría del ranking del endpoint, adquisición de jurisprudencia ni afirmación de cobertura nacional o histórica completa.

La base se verificó como PostgreSQL 16 en `127.0.0.1:55432`, base `buscador_juridico_civil_dev`, rol `bjc_dev`. Las consultas se ejecutaron en transacciones `REPEATABLE READ READ ONLY`; los artefactos detallados del corpus quedan en `_recovery-work/jurisprudencia-j8/`, directorio local ignorado por Git.

## Snapshot certificado

| Universo | Documentos | Archivos | Páginas | Ingestas | Search tokens |
|---|---:|---:|---:|---:|---:|
| Corpus total | 17.078 | 17.098 | 198.129 | 17.685 | 18.799.500 |
| Civil actualmente adquirido | 6.070 | 6.070 auditados | — | — | 9.323.788 |

El subconjunto Civil contiene 6.069 documentos de segunda instancia y 1 de primera instancia. Orígenes: `CIVIL_CUANTIFICACION_DANOS` (4.815), `CSJN_TFN_HISTORICAL` (1.254) y `TFN_ACTUAL_CIVIL` (1). Search contiene los 6.070 documentos Civil.

Manifiesto: 6.070 entradas únicas de 6.070 esperadas, cero duplicadas y cero faltantes. Hash de manifiesto: `b01eaa571e5da8f236669babaff663e8648076c6311e1eac68245122a7281446`. Hash de certificado: `968b208f52bf5634e00596a5baddb010919a66de7aa770c77080287aa74fcb50`.

## Método y estados

La certificación combina la reejecución del inventario J7, dry-runs de calidad y normalización J7.1/J7.1.1, análisis histórico J7.1.2, el paquete J7.1.3 sin decisiones, una auditoría J8 nueva en solo lectura, una muestra determinista de Search/Viewer de 100 documentos y reextracción nativa temporal del documento sin texto. Cada fila registra integridad, procedencia, páginas, Search, Viewer, normalización, Sala, clave legal, representaciones, issues y estado final.

| Estado | Documentos | Interpretación |
|---|---:|---|
| `CERTIFIED` | 4.814 | Sin gap material para el alcance técnico definido. |
| `CERTIFIED_WITH_KNOWN_GAP` | 874 | Utilizable; gap histórico u otra limitación identificada. |
| `HUMAN_REVIEW_PENDING` | 365 | Evidencia preparada para revisión; sin decisiones inventadas. |
| `MODEL_LIMITATION` | 17 | Representación o identidad no resuelta concluyentemente por el modelo actual. |
| `UNRESOLVED` | 0 | — |
| `BROKEN` | 0 | — |
| `UNKNOWN` | 0 | — |

Los estados suman 6.070. `100%` de certificación técnica significa que todos tienen estado explícito y no hay `BROKEN`, `UNKNOWN` o `UNRESOLVED`. No significa metadata completa ni cobertura total de jurisprudencia Civil.

## Integridad de archivos y procedencia

Se recalcularon tamaño y SHA y se verificó la validez de los 6.070 archivos: 6.070 válidos; 0 faltantes, SHA discrepantes, tamaños discrepantes, PDF inválidos, archivos vacíos, HTML tratado como PDF, errores de lectura o estados desconocidos. Se verificaron 6.050 PDFs estructuralmente y 20 archivos de texto. La procedencia está completa en 6.070/6.070; no faltan source records, URLs de origen o ingestas, ni hay procedencia contradictoria o desconocida.

## Páginas

Se revisaron 6.070 documentos y 101.754 filas de páginas; no hubo faltantes, números duplicados ni diferencias de conteo. 6.023 documentos quedaron íntegros sin observaciones. De las 50 páginas sin texto, 46 se verificaron como legítimamente vacías y cuatro son candidatas OCR dentro del documento `TEXT_MISSING`. Ninguna quedó desconocida. La integridad de páginas sin observaciones es 99,2257%; el resto está explicado y clasificado.

## Search y Viewer

Search tiene 6.070/6.070 documentos Civil, 9.323.788 tokens, cero documentos ausentes y cero stale. La preparación de texto es `SEARCH_READY` en 6.069 y metadata-only en 1; ningún documento tiene cero tokens, pues ese registro conserva 61 tokens de metadata. Una comprobación determinista de pertenencia a la proyección recuperó 100/100 tokens seleccionados. No certifica endpoint, ranking ni calidad de recuperación de consultas.

Viewer clasificó 6.069 `READY` y uno `TEXT_MISSING`; no hay archivos ausentes ni metadata de página faltante. La muestra de 100/100 comprobó acceso a storage y mapeo de página. No se invocó la ruta frontend autenticada; esto no es UAT completa de interfaz.

### Dossier del documento sin texto

Un documento histórico tiene un PDF válido de 1.272.583 bytes y cuatro páginas; el extractor nativo obtuvo cero caracteres útiles por página y cero texto almacenado. Las cuatro páginas contienen imágenes con contenido visible. Search conserva 61 tokens de metadata y Viewer lo clasifica `TEXT_MISSING`. Diagnóstico: `OCR_REQUIRED`; la reextracción nativa no recuperó el cuerpo. No se instaló OCR ni se escribió texto. No hay bloqueo técnico para abrir el archivo; queda pendiente OCR aprobado y validación de su resultado.

## Identidad jurídica y Sala

El estado persistido se distingue de la interpretación del normalizador. J7 reportó 4.978 números de expediente válidos según el modelo almacenado. El normalizador J7.1.1 ejecutado en memoria reconoció 4.810 canónicos, 1.247 legacy y un caso multi-causa; dejó 9 parciales, 2 malformados y 1 no soportado. Los 4.978 casos previamente válidos se revalidaron sin cambios inesperados (0 regresiones). Reconocer un formato legacy no completa un año ausente ni altera lo persistido. La simulación conceptual mueve 1.079 banderas `REVIEW` a `GOOD`, sin persistir correcciones.

Sala: 4.816 documentos tienen Sala conocida o juzgado aplicable; 1.254 registros históricos de `CSJN_TFN_HISTORICAL` no tienen Sala propia persistida. Se clasifican en 365 candidatos humanos, 39 ambiguos, 849 sin evidencia propia y 1 con texto insuficiente. No hubo propuestas auto-safe ni decisiones aplicadas. Los 849 son un gap histórico conocido, no errores técnicos.

Claves legales: 4.814 completas y 1.256 parciales: 1.241 por Sala, 2 por año y 13 por varios componentes. Cuatro identidades multi-clave siguen limitadas por el modelo; ninguna clave se completó por inferencia.

## Representaciones, fuentes y bandas heredadas

No hay grupos de SHA duplicado. Persisten 12 grupos de texto normalizado igual con SHA diferente (25 representaciones afectadas): 10 candidatos de representación de una decisión y dos colisiones de texto/metadata genéricos. Se preservan sin fusión. Hay 341 documentos con procedencia múltiple, clasificada como esperada. No hay colisiones o representaciones desconocidas.

Bandas heredadas: EXCELLENT 4.814, GOOD 164, REVIEW 1.092, POOR 0 y BROKEN 0. El normalizador explica conceptualmente 1.079 casos REVIEW como formatos legacy reconocidos; la base no se actualizó. Las bandas no reemplazan los estados J8.

## Gaps pendientes y conclusión

Los gaps materiales conocidos son Sala histórica, extracción de texto que requiere OCR, colas humanas J6.1/J7.1.3 y límites de representación/identidad. J6.1 sigue `READY FOR HUMAN UAT` con 187 casos y muestra 20; J7.1.3 `READY FOR HUMAN REVIEW` con 365 probables, 39 ambiguos y muestra 25. J8 creó cero decisiones humanas.

Conclusión: **`CERTIFIED_WITH_KNOWN_GAPS`**. Los 6.070 documentos actualmente adquiridos fueron revalidados; no hay archivos perdidos o corruptos, procedencia desconocida, documentos ausentes/stale de Search ni casos `BROKEN` o `UNKNOWN`. La calidad e integridad del corpus adquirido están certificadas con los gaps enumerados. La cobertura total de jurisprudencia Civil no se midió ni se afirma.

## Solo lectura y determinismo

Sentinelas antes/después idénticos: 17.078 documentos, 17.098 archivos, 198.129 páginas, 17.685 ingestas, 17.100 extracciones, 17.078 Search documents y 18.799.500 tokens. `verifiedAt` y timestamps relevantes no cambiaron. INSERT/UPDATE/DELETE/DDL, rebuilds de Search y escrituras de storage: cero. Manifiesto y certificado fueron deterministas en dos ejecuciones.

## Re-certificación

Desde `JurisprudenciaN/back`, con el guard activo y base DEV local:

```powershell
node scripts/with-dev-db-guard.cjs j7-corpus-quality-audit
node scripts/with-dev-db-guard.cjs j7-quality-repair-dry-run
node scripts/with-dev-db-guard.cjs sprint-j712-historical-sala-readonly
node scripts/with-dev-db-guard.cjs sprint-j8-civil-certification
```

Revisar manifiesto y sentinelas en `_recovery-work/jurisprudencia-j8/`. Repetir la certificación tras nuevas ingestas, reparaciones, integraciones o cambios de producción, verificando que la conexión siga apuntando exclusivamente a DEV y los sentinelas permanezcan idénticos. Los artefactos con datos reales del corpus no se versionan.
