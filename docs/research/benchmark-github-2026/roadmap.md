# Roadmap con dependencias

## ¿Debe esperar UAT?

**No debe esperar para investigación y diseño.** La aceptación humana de UAT sí es el gate para activar cambios de producto. Esta misión no cambia el estado UAT_READY ni despliega nada.

## Fase 0 — Aceptación, contrato y trazabilidad
**Gate:** aceptación UAT del candidato y dueño de producto.
- Confirmar el contrato de búsqueda actual con un set de regresión.
- Especificar el modelo de búsqueda guardada pública y compatibilidad del esquema existente.
- Fijar un mapa de permisos para Search, favoritos, colección, citas, exportación y alertas.
- Crear el set inicial de relevancia civil con consulta, positivos, negativos y revisión.
**Salida:** especificación, criterios y baseline firmados.

## Fase 1 — Continuidad de consulta
Dependencias: contrato de Fase 0; no requiere IA ni cambios de motor.
- Guardar/restaurar consulta desde página pública.
- Cita copiable con URL estable y campos que existan.
- Favorito desde tarjeta y navegación con vuelta a resultados.
- Ayuda e interpretación fieles al contrato.
- Etiquetar texto completo/sumario/OCR/PDF.
**Criterio:** misma consulta restaurada; no cambia resultados por sí sola; acciones accesibles; permisos correctos.

## Fase 2 — Espacio de investigación
Dependencias: identidad estable de fallos, ACL y modelo de búsqueda guardada.
- Colecciones personales y compartidas, notas, etiquetas y estado de lectura.
- Cita/fuente/página y link de vuelta a Consulta.
- Guardar dentro del espacio sólo si el usuario pertenece y el objeto es visible.
- Auditar cambios y evitar duplicar PDFs.
**Criterio:** pruebas de acceso con usuarios de distinto alcance y UX UAT.

## Fase 3 — Calidad del corpus y relaciones
Dependencias: procedencia estable, extractor revisable y source registry.
- Cola de corrección de metadata/texto.
- Versiones, hash, páginas, OCR y estado de extracción.
- Detector de citas argentinas genera candidatos con evidencia/confianza.
- Revisión humana antes de publicar el grafo.
**Criterio:** precisión por tipo de cita y recall auditado; no resolver automáticamente ambigüedad.

## Fase 4 — Alertas y analítica permitida
Dependencias: búsquedas guardadas y revisión de privacidad.
- Alertas opt-in, retención y baja sencilla; verificar ACL por evento.
- Analítica agregada de calidad, cero resultados y latencia; excluir texto libre por defecto.
- Panel por Sala/fuente/época con denominadores visibles.
**Criterio:** no filtrar búsquedas privadas, cuotas/latencia aprobadas.

## Fase 5 — Modos experimentales
Dependencias: relevancia baseline, disponibilidad lícita del corpus, estrategia de modelos y QA independiente.
- Modo semántico separado y apagable.
- Reranking o RAG sólo con trazabilidad por afirmación/página, conjunto de evaluación y consentimiento.
- MCP read-only sólo si mantiene identidad/ACL y trata documentos como datos no confiables.
**Criterio:** no-regresión léxica, evaluación humana y amenazas documentadas. No activar por defecto.

## Primeros cinco builds posteriores a UAT

1. Integrar “Guardar esta búsqueda” desde Consulta pública y restaurarla exactamente.
2. Añadir acción de copiar cita estructurada con URL estable.
3. Añadir favorito directo en resultado y conservar navegación.
4. Actualizar ayuda/interpretación de búsqueda a los semantics vigentes.
5. Especificar e implementar el primer corte de colecciones de investigación respetando los espacios existentes.

Estos son candidatos de producto; requieren aprobación de priorización y definición técnica después de UAT. Ninguno se implementó en esta investigación.