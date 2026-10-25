# 25 ideas puntuadas y 10 quick wins

## Escala y regla

Cada dimensión va de 1 a 5. **UV** valor de usuario; **IJ** valor de investigación jurídica (5 alto). **E** esfuerzo, **D** datos, **T** riesgo técnico, **L** riesgo legal/institucional, **P** riesgo de performance y **M** costo de mantenimiento: 1 bajo, 5 alto.

Índice de prioridad 1–5:
0,25×UV + 0,25×IJ + 0,10×(6−E) + 0,10×(6−D) + 0,10×(6−T) + 0,10×(6−L) + 0,05×(6−P) + 0,05×(6−M).

La puntuación organiza conversación; no reemplaza esfuerzo estimado, revisión legal, design review ni aprobación UAT. Las iniciativas semánticas salen bajas por carga/riesgo, no por falta de interés. Un quick win significa primer corte pequeño y verificable, no una promesa de calendario.

## Top 25

Vector en orden **UV/IJ/E/D/T/L/P/M**.

| ID | Idea | Vector | Índice | Clase |
|---|---|---:|---:|---|
| Q01 | Guardar búsqueda pública con contrato completo | 5/5/2/1/2/1/1/2 | 4,75 | Quick win acotado |
| Q02 | Copiar cita estructurada con URL y fuente | 4/5/1/1/1/1/1/1 | 4,75 | Quick win |
| Q03 | Favorito desde tarjeta de resultado | 4/3/1/1/1/1/1/1 | 4,25 | Quick win |
| Q04 | Ayuda fiel a prefijo, palabra/frase exacta, ñ y % | 5/4/1/1/1/1/1/1 | 4,75 | Quick win |
| Q05 | Botón de copiar URL de búsqueda actual | 3/3/1/1/1/1/1/1 | 4,00 | Quick win |
| Q06 | Etiqueta de interpretación (prefijo/frase/campo) | 4/4/1/1/2/1/1/1 | 4,40 | Quick win |
| Q07 | Estado claro de texto completo/sumario/OCR/PDF | 4/5/2/2/2/1/1/2 | 4,40 | Quick win acotado |
| Q08 | Navegación indexada de coincidencias en visor público | 4/4/3/2/3/1/3/3 | 3,80 | Medio |
| Q09 | Colecciones con notas/etiquetas sin duplicar archivos | 5/5/3/1/2/1/1/2 | 4,65 | Alto valor, medio |
| Q10 | Historial de búsquedas privado y desactivable | 3/3/2/1/2/2/1/2 | 3,65 | Quick win acotado |
| Q11 | Alertas opt-in de nuevas decisiones | 4/5/4/2/3/3/3/4 | 3,70 | Medio |
| Q12 | Grafo de citas entrantes/salientes con procedencia | 5/5/5/4/4/4/4/4 | 3,40 | Estratégico |
| Q13 | Extracción/resolución de citas con revisión humana | 5/5/5/4/4/4/3/4 | 3,45 | Estratégico |
| Q14 | Conjunto de evaluación y relevancia civil local | 5/5/3/3/2/1/2/3 | 4,35 | Alto valor, medio |
| Q15 | Búsqueda semántica opcional y aislada | 4/4/5/4/5/4/4/5 | 2,75 | Experimental |
| Q16 | Asistente jurídico con citas verificadas | 4/4/5/4/5/5/4/5 | 2,65 | Experimental/postergar |
| Q17 | Flujo de procedencia/corrección de corpus | 4/5/4/3/3/2/2/3 | 3,80 | Estratégico |
| Q18 | Comparación de fallos/pasajes en paralelo | 4/4/4/2/3/1/3/3 | 3,70 | Medio |
| Q19 | Línea de tiempo de relaciones entre fallos | 4/5/4/3/3/2/2/3 | 3,80 | Estratégico |
| Q20 | Exportación de colección con controles de acceso | 4/4/3/1/3/4/3/3 | 3,60 | Medio; revisión jurídica |
| Q21 | Búsqueda conjunta pública/privada con ACL | 4/5/4/2/4/3/4/4 | 3,55 | Estratégico |
| Q22 | Analítica privada de calidad/cero resultados | 3/4/4/3/3/5/2/4 | 2,95 | Experimental; privacidad |
| Q23 | Panel de calidad por fuente/Sala/año | 4/5/3/3/2/1/2/3 | 4,10 | Alto valor, medio |
| Q24 | Detección de duplicados/versiones de fallo | 4/4/4/3/3/2/3/4 | 3,45 | Medio |
| Q25 | Plantillas de consulta civil revisadas por abogados | 5/5/3/2/2/2/2/3 | 4,35 | Alto valor, medio |

## Diez quick wins candidatos

Todos requieren verificación visual y aceptación UAT antes de considerarse listos. Algunos están parcialmente presentes; se propone cerrar la experiencia y no duplicar controles existentes.

1. **Q04 — Actualizar ayuda de búsqueda.** Mostrar ejemplos que respeten la semántica real del motor.
2. **Q05 — Copiar URL.** Acción contextual con confirmación, aunque el estado ya se serializa en la URL.
3. **Q02 — Copiar cita.** Usar sólo metadata disponible y señalar campos vacíos.
4. **Q03 — Favorito en resultado.** Reusar servicio actual y permitir deshacer.
5. **Q06 — Mostrar interpretación.** Prefijo/frase/campo, sin exponer score interno.
6. **Q07 — Etiquetas de contenido.** Diferenciar sumario, completo, OCR y PDF; no confundir archivo con texto indexado.
7. **Q01 — Guardar consulta.** Primer corte con restauración exacta de URL/filtros y ámbito público; requiere integración con el contrato guardado actual.
8. **Retorno a resultados.** Verificar si abrir un fallo conserva página, filtros y query; corregir sólo si la ruta pierde estado.
9. **Accesibilidad de filtros.** Auditar teclado, labels y lectura de filtros activos; arreglar los defectos encontrados.
10. **Q10 — Historial sólo local/privado.** Si se prioriza, poner interruptor y borrado visible; no enviar búsquedas a analítica.

## Selección por horizonte

- **Quick wins:** Q01–Q07 y Q10 más los dos cierres UX anteriores, con alcance limitado.
- **Medio:** Q08, Q11, Q14, Q18, Q20, Q23, Q24, Q25.
- **Estratégico:** Q09, Q12, Q13, Q17, Q19, Q21.
- **Experimental:** Q15 y Q22; Q16 sólo después de evidencia, privacidad y revisión.