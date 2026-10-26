# Patrones de cita observados en el corpus civil

## Método y alcance

Se analizaron las mismas 200 sentencias públicas activas con 3.350 páginas extraídas desde su último Corpus GENERAL. El origen y la transacción read-only se detallan en [judgment-structure-patterns.md](judgment-structure-patterns.md). Los recortes de revisión se guardan fuera de Git en `_recovery-work/galilei-structured-citations-suite3/`; los ejemplos de esta página están generalizados para no publicar carátulas.

## Familias emitidas por `argentine-citation-parser-v2`

| Familia | Candidatos en la muestra | Forma observada |
|---|---:|---|
| `STATUTE_REFERENCE` | 4.524 | `art. 165 del CPCCN`, artículos de códigos y leyes |
| `EXPEDIENTE_IDENTIFIER` | 821 | `Expte. 69.397/2003`, `causa 1.795/2014` |
| `CSJN_FALLOS` | 332 | `Fallos: 329:4944`, `CSJN, “Fallos”: 274:113`, `Fallos, 282:193` |
| `CNCIV_SALA_DATE` | 183 | `CNCiv., Sala E, 3/4/96` |
| `OTHER_COURT` | 98 | tribunal seguido por señal de referencia, como SCBA + fecha o CNCiv en pleno + repertorio |
| `CNCIV_ROLLO` | 47 | `R. 34.061 del 18-11-87` |
| `CIVIL_EXPEDIENTE` | 25 | `CIV 86.481/2009` |
| `CSJN_DECISION_DATE` | 43 | `C.S.J.N., 28/05/2002` |
| `CSJN_CASE` | 1 | docket CSJN con sufijo de expediente, por ejemplo `CSJN 678/2013 (49-F)/CS1` |

El conjunto suma 6.074 detecciones. Las referencias normativas se mantienen separadas de los candidatos a relación entre fallos. La mención desnuda de un tribunal no basta: `OTHER_COURT` exige señales cercanas de cita; las menciones CSJN ya cubiertas por Fallos, fecha o docket se descartan como duplicados.

## Resolución exacta

Se compararon identificadores contra 6.014 sentencias publicadas y activas usando sólo expediente/identificador explícito, Sala y fecha cuando el texto los provee. La comparación es exacta tras normalizar puntuación y espacios; no se asigna siglo a años de dos dígitos y no se elige el primer resultado.

- 154 coincidencias exactas con el expediente o número del fallo de origen se clasificaron `SELF_REFERENCE` y no generan relación.
- Entre los 689 candidatos con identificador normalizable que no coincidía exactamente con el origen, 68 resolvieron a un único fallo público activo, 0 fueron ambiguos y 621 quedaron sin coincidencia exacta.
- `Fallos`, fechas de Sala/CSJN, rollos, normas y menciones de tribunal no se fuerzan a resolver como expediente local.

Una resolución única sólo identifica un destino candidato. La relación sigue en estado `DETECTED_CANDIDATE` hasta que una persona la confirme; el parser nunca marca una relación como verificada.

## Revisión manual

Se inspeccionaron 50 candidatos en su página y contexto fuente, distribuidos por familia. Los 50 correspondían a referencias de expedientes/fallos, autoridades judiciales o normas según su familia; 6 coincidían exactamente con el identificador de origen y estaban correctamente suprimidos como autoreferencia. No se observaron falsos positivos en esa muestra estratificada. El resultado 50/50 describe sólo esa muestra deliberada, no una precisión global ponderada. Recall no medido: las referencias que el parser no detecta no forman parte de la muestra de candidatos.

## Límites conocidos

Los expedientes abreviados pueden ser citas de un mismo expediente sin normalizar exactamente; los fallos acumulados pueden citar otro expediente de la misma decisión; referencias con fecha o Sala sin expediente no son inequívocas. Se conservan para revisión humana o se dejan sin candidato de resolución automática. No se cubren todos los repertorios, formatos de expediente, abreviaturas, cámaras provinciales ni citas con OCR degradado.
