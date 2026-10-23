# 57 — Clasificación documental v1

## Política aplicada

La v1 es determinista y local; usa `searchText` normalizado y reglas, no IA. Cada salida se guarda como `origin=RULE`, `reviewStatus=SUGGESTED`, con evidencia de términos y confianza 0,72 (un término coincidente) o 0,86 (más de uno). `SUGGESTED` no implica exactitud jurídica, aprobación, publicación ni selección para Jurisprudencia.

La dimensión está preparada para `LEGACY`, `EXISTING_METADATA`, `RULE`, `AI` y `HUMAN`, con estados sugerido/aprobado/rechazado. Esta importación no produjo etiquetas aprobadas de metadata: no hubo vínculos EXACT; no se generaron clasificaciones AI/HUMAN.

## Resultado real

Se evaluaron 10.731 documentos indexados o `OCR_REQUIRED`; el `INVALID_PDF` quedó fuera de la evaluación de texto. Hay **21.547 sugerencias RULE** sobre **8.667 documentos** y **2.064 sin sugerencias**. No se observaron aprobadas o rechazadas. Cantidad de sugerencias por tema:

| Tema sugerido | Cantidad |
|---|---:|
| Contratos | 3.398 |
| Daños | 4.878 |
| Familia | 1.660 |
| Honorarios | 1.612 |
| Locaciones | 1.842 |
| Prescripción | 359 |
| Procesal | 1.353 |
| Propiedad | 2.080 |
| Responsabilidad civil | 2.025 |
| Sucesiones | 2.340 |

Un documento puede recibir más de un tema; por eso 21.547 sugerencias no equivale al número de documentos clasificados. Estas diez reglas no constituyen una taxonomía completa ni reemplazan temas oficiales existentes.

## Evaluación reproducible

Se tomó la primera muestra de 100 items elegibles ordenados por `itemKey` SHA-256 ascendente del run `5a3ececa-3a55-4a08-bd20-bb43ce3e006d`, manifest `4e0f484a1603e5d73787982f630af5006c3906a94323b17e5fa619f162ac0224`; rango de claves `00020f0c…` a `02244fb1…`. En la muestra: 82 documentos con reglas, 200 sugerencias, 268 términos de evidencia revisados y 268 presentes en el `searchText` persistido. Eso valida que la evidencia mecánica de las reglas concuerda con el texto; **no mide precisión semántica**. Ground truth EXACT y etiquetas aprobadas existentes: 0. No se inventa una precisión jurídica ni falsos positivos validados por una persona.

Comando reproducible, protegido por guard DEV: `node scripts/with-dev-db-guard.cjs institutional-classification-evaluate 5a3ececa-3a55-4a08-bd20-bb43ce3e006d`.

## Curaduría pendiente

Las 21.547 filas continúan como sugerencias. Selección jurisprudencial, motivos (novedoso/cambio/contradicción/relevancia), aprobación/rechazo, responsable e historial humano se implementan en el workflow de Sprint 9. El origen AI queda preparado, sin proveedor ni dependencia externa.
