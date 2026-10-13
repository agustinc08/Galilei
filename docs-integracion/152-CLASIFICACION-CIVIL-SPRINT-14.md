# 152 — Clasificación Civil con evidencia — Sprint 14

`scripts/sources/sprint14/core.cjs` define reglas determinísticas y salidas explicables:

| Salida | Evidencia suficiente |
|---|---|
| `CIVIL_EXACT` | Tribunal normalizado coincide con Cámara Nacional de Apelaciones en lo Civil/Cámara Nacional Civil o Juzgado Nacional en lo Civil. |
| `CIVIL_HIGH_CONFIDENCE` | Materia oficial estructurada es Civil, o prefijo de expediente identificado como `CIV`/`CIVCOM`. |
| `CIVIL_CANDIDATE` | Sólo aparece “civil” en título, sumario, tribunal no canónico o texto; requiere revisión. |
| `NON_CIVIL` | Tribunal estructurado identifica explícitamente fuero penal, laboral, contencioso administrativo o electoral. |
| `UNRESOLVED` | Sin evidencia suficiente. |

Cada resultado contiene score y claves de evidencia; la palabra “civil” aislada nunca produce `CIVIL_EXACT`. No hay registros de sentencias individuales adquiridos en Sprint 14: las cantidades por clase son “0 procesados”, no “0 fallos civiles encontrados”. Los tomos CSJN son contenedores mixtos y quedan sin clasificación por materia hasta contar con registros de fallo.
